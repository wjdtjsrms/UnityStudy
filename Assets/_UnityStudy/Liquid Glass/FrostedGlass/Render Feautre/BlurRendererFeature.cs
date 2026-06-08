using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.RenderGraphModule.Util;

public class BlurRendererFeature : ScriptableRendererFeature
{
    [System.Serializable]
    public class Settings
    {
        public Material blurMaterial;
        [Range(1, 6)] public int iterations = 3;
        [Range(1, 8)] public int downsample = 4;
    }

    public Settings settings = new();

    // 두 개의 패스로 나눕니다!
    private HighEndBlurRenderPass _blurPass;     // Feature A: 블러 생성
    private BlurKeepAlivePass _keepAlivePass;    // Feature B: 메모리 유지

    public override void Create()
    {
        if (settings.blurMaterial == null) return;

        _blurPass = new HighEndBlurRenderPass(settings);
        _keepAlivePass = new BlurKeepAlivePass();
    }

    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
    {
        if (_blurPass == null) return;
        var cameraType = renderingData.cameraData.cameraType;
        if (cameraType != CameraType.Game && cameraType != CameraType.SceneView) return;

        // 렌더 파이프라인에 A와 B를 순서대로 밀어 넣습니다.
        renderer.EnqueuePass(_blurPass);
        renderer.EnqueuePass(_keepAlivePass);
    }

    // =========================================================================
    // 📦 A와 B가 소통할 데이터 상자 (ContextItem)
    // =========================================================================
    public class BlurSharedData : ContextItem
    {
        public TextureHandle blurredTexture;
        public override void Reset() { blurredTexture = TextureHandle.nullHandle; }
    }

    // =========================================================================
    // 🚀 Feature A : 블러 생성 (Before Transparents)
    // =========================================================================
    public class HighEndBlurRenderPass : ScriptableRenderPass
    {
        private Settings passSettings;
        public HighEndBlurRenderPass(Settings settings)
        {
            this.passSettings = settings;
            this.renderPassEvent = RenderPassEvent.BeforeRenderingTransparents;
        }

        private class PassData { }

        public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
        {
            UniversalCameraData cameraData = frameData.Get<UniversalCameraData>();
            UniversalResourceData resourceData = frameData.Get<UniversalResourceData>();

            if (!cameraData.requiresOpaqueTexture) return;
            TextureHandle engineBgTexture = resourceData.cameraOpaqueTexture;
            if (!engineBgTexture.IsValid()) return;

            // --- 1. 해상도 축소 ---
            TextureDesc downsampledDesc = renderGraph.GetTextureDesc(engineBgTexture);
            downsampledDesc.width = Mathf.Max(1, downsampledDesc.width / passSettings.downsample);
            downsampledDesc.height = Mathf.Max(1, downsampledDesc.height / passSettings.downsample);
            downsampledDesc.clearBuffer = false;
            downsampledDesc.name = "Initial_Downsample_Texture";

            TextureHandle currentSource = renderGraph.CreateTexture(downsampledDesc);

            RenderGraphUtils.BlitMaterialParameters initBlitParams = new(engineBgTexture, currentSource, passSettings.blurMaterial, 0);
            renderGraph.AddBlitPass(initBlitParams, "Initial Downsample");

            TextureHandle[] mipPyramid = new TextureHandle[passSettings.iterations];
            mipPyramid[0] = currentSource;

            // --- 2. Downsample & Upsample 루프 ---
            for (int i = 1; i < passSettings.iterations; i++)
            {
                downsampledDesc.width = Mathf.Max(1, downsampledDesc.width / 2);
                downsampledDesc.height = Mathf.Max(1, downsampledDesc.height / 2);
                downsampledDesc.name = $"Downsample_Mip_{i}";
                TextureHandle downTarget = renderGraph.CreateTexture(downsampledDesc);
                mipPyramid[i] = downTarget;

                RenderGraphUtils.BlitMaterialParameters downBlitParams = new(currentSource, downTarget, passSettings.blurMaterial, 0);
                renderGraph.AddBlitPass(downBlitParams, $"Blur Downsample {i}");
                currentSource = downTarget;
            }

            for (int i = passSettings.iterations - 2; i >= 0; i--)
            {
                TextureHandle upTarget = mipPyramid[i];
                RenderGraphUtils.BlitMaterialParameters upBlitParams = new(currentSource, upTarget, passSettings.blurMaterial, 1);
                renderGraph.AddBlitPass(upBlitParams, $"Blur Upsample {i}");
                currentSource = upTarget;
            }

            // --- 3. 글로벌 이름표 달기 ---
            using var builder = renderGraph.AddRasterRenderPass<PassData>("Set Global Blur", out var passData);
            builder.UseTexture(currentSource, AccessFlags.Read);
            // [해결 1] 렌더 그래프가 이 패스를 생략(Culling)하지 못하게 강제합니다!
            builder.AllowGlobalStateModification(true);
            builder.SetGlobalTextureAfterPass(currentSource, Shader.PropertyToID("_GlobalBlurredTexture"));
            builder.SetRenderFunc((PassData data, RasterGraphContext ctx) => { });

            // --- 4. B에게 생명줄 넘겨주기 ---
            var sharedData = frameData.GetOrCreate<BlurSharedData>();
            sharedData.blurredTexture = currentSource;
        }
    }

    // =========================================================================
    // 🛡️ Feature B : 메모리 생명 연장 지킴이 (After Transparents)
    // =========================================================================
    public class BlurKeepAlivePass : ScriptableRenderPass
    {
        public BlurKeepAlivePass()
        {
            // UI가 텍스처를 다 쓰고 난 뒤에 실행되도록 타이밍을 맞춥니다!
            this.renderPassEvent = RenderPassEvent.AfterRenderingTransparents;
        }

        private class PassData { }

        public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
        {
            var sharedData = frameData.Get<BlurSharedData>();
            if (sharedData == null || !sharedData.blurredTexture.IsValid()) return;

            using var builder = renderGraph.AddRasterRenderPass<PassData>("Keep Blur Alive", out var passData);

            // [해결 2] 렌더 그래프에게 "내가 아직 이 텍스처를 쥐고 있어!" 라고 선언합니다.
            // 이 덕분에 UI 셰이더가 안전하게 텍스처를 읽을 수 있습니다.
            builder.UseTexture(sharedData.blurredTexture, AccessFlags.Read);
            builder.AllowPassCulling(false); // 생략 방지

            builder.SetRenderFunc((PassData data, RasterGraphContext ctx) => { });
        }
    }
}
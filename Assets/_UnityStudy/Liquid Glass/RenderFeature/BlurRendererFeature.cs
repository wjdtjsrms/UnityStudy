using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.Rendering.RenderGraphModule;

public class BlurRendererFeature : ScriptableRendererFeature
{
    [System.Serializable]
    public class Settings
    {
        public Shader shader;

        [Range(1, 6)]
        [Tooltip("반복 횟수. 높을수록 더 강한 blur. 모바일 권장: 3~4")]
        public int iterations = 3;

        [Range(0.5f, 3.0f)]
        [Tooltip("샘플링 offset. 높을수록 더 퍼지는 blur")]
        public float offset = 1.0f;
    }

    public Settings settings = new();

    private BlurRenderPass _pass;
    private Material _material;

    public override void Create()
    {
        if (settings.shader == null) return;

        _material = CoreUtils.CreateEngineMaterial(settings.shader);
        _pass = new BlurRenderPass(_material, settings.iterations, settings.offset);
    }

    public override void AddRenderPasses(ScriptableRenderer renderer,
                                         ref RenderingData renderingData)
    {
        if (_material == null || _pass == null) return;

        var cameraType = renderingData.cameraData.cameraType;
        if (cameraType != CameraType.Game && cameraType != CameraType.SceneView)
            return;

        _pass.ConfigureInput(ScriptableRenderPassInput.Color);
        renderer.EnqueuePass(_pass);
    }

    protected override void Dispose(bool disposing)
    {
        CoreUtils.Destroy(_material);
    }

    public class BlurRenderPass : ScriptableRenderPass
    {
        private class PassData
        {
            public TextureHandle src;
            public Material material;
            public int passIndex; // 0 = Down, 1 = Up
        }

        private static readonly int s_BlurResultId =
            Shader.PropertyToID("_LiquidGlassBlurTex");

        private static readonly int s_CaptureTexId =
            Shader.PropertyToID("_LiquidGlassCaptureTex");

        private static readonly int s_OffsetId =
            Shader.PropertyToID("_Offset");

        private readonly Material _material;
        private readonly int _iterations;
        private readonly float _offset;

        public BlurRenderPass(Material material, int iterations, float offset)
        {
            _material = material;
            _iterations = iterations;
            _offset = offset;

            renderPassEvent = RenderPassEvent.BeforeRenderingTransparents;
        }

        public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
        {
            if (_material == null) return;

            _material.SetFloat(s_OffsetId, _offset);

            var resourceData = frameData.Get<UniversalResourceData>();
            var desc = resourceData.activeColorTexture.GetDescriptor(renderGraph);
            desc.depthBufferBits = 0;
            desc.msaaSamples = MSAASamples.None;

            TextureHandle[] buffers = new TextureHandle[_iterations + 1];

            // Down 0 입력: _LiquidGlassCaptureTex를 셰이더가 직접 전역 참조
            // → buffers[0]은 더미로 activeColorTexture 사용 (실제 샘플링 안 함)
            buffers[0] = resourceData.activeColorTexture;

            // ── DownSample 체인 ──────────────────────────────
            for (int i = 0; i < _iterations; i++)
            {
                var downDesc = desc;
                downDesc.width = Mathf.Max(1, desc.width >> (i + 1));
                downDesc.height = Mathf.Max(1, desc.height >> (i + 1));
                downDesc.name = $"_KawaseDown_{i}";
                buffers[i + 1] = renderGraph.CreateTexture(downDesc);

                // i == 0 이면 셰이더가 _LiquidGlassCaptureTex 직접 샘플링
                // i > 0 이면 이전 버퍼(_BlitTexture)를 샘플링
                AddBlitPass(renderGraph, buffers[i], buffers[i + 1], 0,
                            $"Kawase Down {i}",
                            globalTexId: -1,
                            useGlobalCapture: i == 0);
            }

            // ── UpSample 체인 ────────────────────────────────
            for (int i = _iterations - 1; i >= 0; i--)
            {
                var upDesc = desc;
                upDesc.width = Mathf.Max(1, desc.width >> i);
                upDesc.height = Mathf.Max(1, desc.height >> i);
                upDesc.name = i == 0 ? "_LiquidGlassBlurTex" : $"_KawaseUp_{i}";

                var upTarget = renderGraph.CreateTexture(upDesc);
                bool isFinal = i == 0;

                AddBlitPass(renderGraph, buffers[i + 1], upTarget, 1,
                            $"Kawase Up {i}",
                            isFinal ? s_BlurResultId : -1);

                if (isFinal) buffers[0] = upTarget;
            }
        }
        private void AddBlitPass(RenderGraph renderGraph,
                               TextureHandle src, TextureHandle dst,
                               int passIndex, string passName,
                               int globalTexId = -1,
                               bool useGlobalCapture = false)
        {
            using var builder = renderGraph.AddRasterRenderPass<PassData>(passName, out var passData);

            passData.src = src;
            passData.material = _material;
            passData.passIndex = passIndex;

            if (useGlobalCapture)
                // 전역 텍스처를 이 Pass의 입력으로 선언 (Render Graph 의존성 추적)
                builder.UseGlobalTexture(s_CaptureTexId);
            else
                builder.UseTexture(src);

            builder.SetRenderAttachment(dst, 0);
            builder.AllowPassCulling(false);

            if (globalTexId != -1)
                builder.SetGlobalTextureAfterPass(dst, globalTexId);

            builder.SetRenderFunc(static (PassData data, RasterGraphContext ctx) =>
            {
                ctx.cmd.DrawProcedural(
                    Matrix4x4.identity,
                    data.material,
                    data.passIndex,
                    MeshTopology.Triangles,
                    3
                );
            });
        }
    }
}
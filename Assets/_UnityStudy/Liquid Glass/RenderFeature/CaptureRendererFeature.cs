using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.Rendering.RenderGraphModule;
public class CaptureRendererFeature : ScriptableRendererFeature
{
    [System.Serializable]
    public class Settings
    {
        [Range(1, 4)] public int downsampleFactor = 1;
    }

    public Settings settings = new();
    private CaptureRenderPass _pass;

    public override void Create()
    {
        _pass = new CaptureRenderPass(settings.downsampleFactor);
    }

    public override void AddRenderPasses(ScriptableRenderer renderer,
                                         ref RenderingData renderingData)
    {
        var cameraType = renderingData.cameraData.cameraType;
        if (cameraType != CameraType.Game && cameraType != CameraType.SceneView)
            return;

        // ← 이 한 줄이 핵심
        // URP에게 "이 Pass는 카메라 컬러를 읽는다"고 선언
        // → URP가 BackBuffer 대신 intermediate texture를 자동으로 사용
        _pass.ConfigureInput(ScriptableRenderPassInput.Color);

        renderer.EnqueuePass(_pass);
    }

    public class CaptureRenderPass : ScriptableRenderPass
    {
        private class PassData
        {
            public TextureHandle src;   // 카메라 컬러 (읽기 소스)
            public TextureHandle dst;   // 캡처 목적지
        }

        private static readonly int s_CaptureTexId =
            Shader.PropertyToID("_LiquidGlassCaptureTex");

        private readonly int _downsample;

        public CaptureRenderPass(int downsample)
        {
            _downsample = Mathf.Max(1, downsample);
            renderPassEvent = RenderPassEvent.BeforeRenderingTransparents;

            // 카메라 컬러를 읽으려면 intermediate texture 필수
            // (BackBuffer는 GPU 설계상 동일 프레임에 읽기 불가)
            requiresIntermediateTexture = true;
        }

        public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
        {
            var resourceData = frameData.Get<UniversalResourceData>();
            var src = resourceData.activeColorTexture;

            var desc = src.GetDescriptor(renderGraph);
            desc.width = Mathf.Max(1, desc.width / _downsample);
            desc.height = Mathf.Max(1, desc.height / _downsample);
            desc.depthBufferBits = 0;
            desc.msaaSamples = MSAASamples.None;
            desc.name = "_LiquidGlassCaptureTex";
            desc.filterMode = FilterMode.Bilinear;
            desc.wrapMode = TextureWrapMode.Clamp;

            var dst = renderGraph.CreateTexture(desc);

            using (var builder = renderGraph.AddRasterRenderPass<PassData>(
                       "LiquidGlass Capture", out var passData))
            {
                passData.src = src;
                passData.dst = dst;

                builder.UseTexture(src);
                builder.SetRenderAttachment(dst, 0);
                builder.SetGlobalTextureAfterPass(dst, s_CaptureTexId);
                builder.AllowPassCulling(false);

                builder.SetRenderFunc(static (PassData data, RasterGraphContext ctx) =>
                {
                    Blitter.BlitTexture(ctx.cmd, data.src, new Vector4(1, 1, 0, 0), 0, false);
                });
            }
        }
    }
}
using System;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.RenderGraphModule.Util;

public class DownSampleGlobalRenderFeature : ScriptableRendererFeature
{
    [SerializeField] DownSampleGlobalRenderFeatureSettings settings;
    DownSampleGlobalRenderFeaturePass m_ScriptablePass;

    /// <inheritdoc/>
    public override void Create()
    {
        m_ScriptablePass = new DownSampleGlobalRenderFeaturePass(settings);
        m_ScriptablePass.renderPassEvent = RenderPassEvent.BeforeRenderingTransparents;
    }

    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
    {
        renderer.EnqueuePass(m_ScriptablePass);
    }

    [Serializable]
    public class DownSampleGlobalRenderFeatureSettings
    {
        public Material blitMaterial;
        [Range(1, 16)] public int downsample = 16;
    }

    class DownSampleGlobalRenderFeaturePass : ScriptableRenderPass
    {
        readonly DownSampleGlobalRenderFeatureSettings settings;
        readonly int globalTextureID = Shader.PropertyToID("_MyGlobalTexture");

        private class PassData { }

        public DownSampleGlobalRenderFeaturePass(DownSampleGlobalRenderFeatureSettings settings)
        {
            this.settings = settings;
        }

        public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
        {
            UniversalResourceData resourceData = frameData.Get<UniversalResourceData>();

            if (resourceData.isActiveTargetBackBuffer) return;
            if (!settings.blitMaterial) return;

            TextureHandle source = resourceData.activeColorTexture;
            TextureDesc destinationDesc = renderGraph.GetTextureDesc(source);
            destinationDesc.width /= settings.downsample;
            destinationDesc.height /= settings.downsample;
            destinationDesc.clearBuffer = false;
            TextureHandle destination = renderGraph.CreateTexture(destinationDesc);

            RenderGraphUtils.BlitMaterialParameters blitParams = new(source, destination, settings.blitMaterial, 0);
            renderGraph.AddBlitPass(blitParams, "SimpleBlitPass");

            using (var builder = renderGraph.AddUnsafePass<PassData>("DownsampleGlobalPass", out var passData))
            {
                builder.AllowGlobalStateModification(true);
                builder.UseTexture(destination, AccessFlags.Read);
                builder.SetGlobalTextureAfterPass(destination, globalTextureID);
                builder.SetRenderFunc((PassData data, UnsafeGraphContext context) => { });
            }
        }
    }
}

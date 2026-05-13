Shader "LiquidGlass/Passthrough_Blur"
{
    Properties
    {
        // Inspector에서 확인용 (셰이더가 직접 전역 텍스처를 참조하므로 실제론 미사용)
        [HideInInspector] _MainTex("Main Tex", 2D) = "white" {}
    }

    SubShader
    {
        Tags
        {
            "RenderType"     = "Transparent"
            "Queue"          = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
        }

        Pass
        {
            Name "LiquidGlass_Passthrough"

            ZWrite Off
            ZTest Always
            Cull Off
            Blend SrcAlpha OneMinusSrcAlpha

            HLSLPROGRAM
            #pragma vertex   Vert
            #pragma fragment Frag

            // XR 매크로 없는 순수 URP Core include
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            // 일반 2D 텍스처 선언 (TEXTURE2D_X 아님)
            TEXTURE2D(_LiquidGlassBlurTex);
            SAMPLER(sampler_LiquidGlassBlurTex);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv         : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float2 uv          : TEXCOORD0;
            };

            Varyings Vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionHCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.uv = IN.uv;
                return OUT;
            }

            half4 Frag(Varyings IN) : SV_Target
            {
            return SAMPLE_TEXTURE2D(
                _LiquidGlassBlurTex,
                sampler_LiquidGlassBlurTex,
                IN.uv
);
            }
            ENDHLSL
        }
    }
}
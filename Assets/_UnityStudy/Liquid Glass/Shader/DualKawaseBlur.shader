Shader "LiquidGlass/DualKawaseBlur"
{
    Properties
    {
        // offset: 샘플링 간격. 클수록 더 넓은 blur
        // 런타임에서 Material.SetFloat로 제어
        _Offset("Offset", Float) = 1.0
    }

    SubShader
    {
        Tags
        {
            "RenderType"     = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
        }

        // ── Pass 0: DownSample ─────────────────────────────────────
        // 중심 1tap + 대각선 4tap → 5 tap 합산 평균
        Pass
        {
            Name "DualKawase_DownSample"
            ZWrite Off ZTest Always Cull Off

            HLSLPROGRAM
            #pragma vertex   Vert
            #pragma fragment FragDown
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_LiquidGlassCaptureTex);
            SAMPLER(sampler_LiquidGlassCaptureTex);
            float4 _LiquidGlassCaptureTex_TexelSize;
            float  _Offset;

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings   { float4 positionHCS : SV_POSITION; float2 uv : TEXCOORD0; };

            Varyings Vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionHCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.uv = IN.uv;
                return OUT;
            }

            half4 FragDown(Varyings IN) : SV_Target
            {
                float2 texelSize = _LiquidGlassCaptureTex_TexelSize.xy;
                float2 uv = IN.uv;

                // FragDown 안 샘플링도 전부 교체
                half4 col = SAMPLE_TEXTURE2D(_LiquidGlassCaptureTex, sampler_LiquidGlassCaptureTex, uv) * 0.5;

                float2 o = _LiquidGlassCaptureTex_TexelSize.xy * _Offset * 0.5;
                col += SAMPLE_TEXTURE2D(_LiquidGlassCaptureTex, sampler_LiquidGlassCaptureTex, uv + float2(-o.x,  o.y)) * 0.125;
                col += SAMPLE_TEXTURE2D(_LiquidGlassCaptureTex, sampler_LiquidGlassCaptureTex, uv + float2( o.x,  o.y)) * 0.125;
                col += SAMPLE_TEXTURE2D(_LiquidGlassCaptureTex, sampler_LiquidGlassCaptureTex, uv + float2(-o.x, -o.y)) * 0.125;
                col += SAMPLE_TEXTURE2D(_LiquidGlassCaptureTex, sampler_LiquidGlassCaptureTex, uv + float2( o.x, -o.y)) * 0.125;

                return col;
            }
            ENDHLSL
        }

        // ── Pass 1: UpSample ───────────────────────────────────────
        // 대각선 4tap + 축 방향 4tap → 8 tap 합산 평균
        Pass
        {
            Name "DualKawase_UpSample"
            ZWrite Off ZTest Always Cull Off

            HLSLPROGRAM
            #pragma vertex   Vert
            #pragma fragment FragUp
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_BlitTexture);
            SAMPLER(sampler_BlitTexture);

            float4 _BlitTexture_TexelSize;
            float  _Offset;

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings   { float4 positionHCS : SV_POSITION; float2 uv : TEXCOORD0; };

            Varyings Vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionHCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.uv = IN.uv;
                return OUT;
            }

            half4 FragUp(Varyings IN) : SV_Target
            {
                float2 texelSize = _BlitTexture_TexelSize.xy;
                float2 uv = IN.uv;
                float2 o  = texelSize * _Offset;

                half4 col = 0;

                // 대각선 4방향 (가중치 각 2/12)
                col += SAMPLE_TEXTURE2D(_BlitTexture, sampler_BlitTexture, uv + float2(-o.x,  o.y)) * 2.0;
                col += SAMPLE_TEXTURE2D(_BlitTexture, sampler_BlitTexture, uv + float2( o.x,  o.y)) * 2.0;
                col += SAMPLE_TEXTURE2D(_BlitTexture, sampler_BlitTexture, uv + float2(-o.x, -o.y)) * 2.0;
                col += SAMPLE_TEXTURE2D(_BlitTexture, sampler_BlitTexture, uv + float2( o.x, -o.y)) * 2.0;

                // 축 방향 4방향 (가중치 각 1/12)
                col += SAMPLE_TEXTURE2D(_BlitTexture, sampler_BlitTexture, uv + float2(-2.0*o.x, 0.0)) * 1.0;
                col += SAMPLE_TEXTURE2D(_BlitTexture, sampler_BlitTexture, uv + float2( 2.0*o.x, 0.0)) * 1.0;
                col += SAMPLE_TEXTURE2D(_BlitTexture, sampler_BlitTexture, uv + float2(0.0, -2.0*o.y)) * 1.0;
                col += SAMPLE_TEXTURE2D(_BlitTexture, sampler_BlitTexture, uv + float2(0.0,  2.0*o.y)) * 1.0;

                // 총 가중치 = 2*4 + 1*4 = 12
                return col / 12.0;
            }
            ENDHLSL
        }
    }
}
Shader "Hidden/AppleVision/DualKawaseBlur"
{
    Properties
    {
        _Offset ("Blur Offset", Float) = 1.0
    }
    
    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline" = "UniversalPipeline"}
        // 깊이 계산이나 화면 밖을 그리지 않도록 최적화
        ZWrite Off Cull Off ZTest Always

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        // [핵심 변경점] URP 최신 렌더 그래프 전용 Blit 라이브러리 추가!
        // 이 라이브러리가 _BlitTexture, _BlitTexture_TexelSize, Vert 함수를 모두 자동 제공합니다.
        #include "Packages/com.unity.render-pipelines.core/Runtime/Utilities/Blit.hlsl"

        float _Offset;

        half4 fragDown(Varyings input) : SV_Target
        {
            float2 uv = input.texcoord;
            float2 halfPixel = _BlitTexture_TexelSize.xy * _Offset * 0.5;

            half4 sum = SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv) * 4.0;
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv - halfPixel);
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + halfPixel);
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2( halfPixel.x, -halfPixel.y));
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2(-halfPixel.x,  halfPixel.y));

            return sum * 0.125;
        }

        half4 fragUp(Varyings input) : SV_Target
        {
            float2 uv = input.texcoord;
            float2 offset  = _BlitTexture_TexelSize.xy * _Offset * 0.5;
            float2 offset2 = offset * 2.0;

            half4 sum = 0;
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2(-offset2.x,  0.0      ));
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2(-offset.x,   offset.y )) * 2.0;
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2( 0.0,         offset2.y));
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2( offset.x,   offset.y )) * 2.0;
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2( offset2.x,  0.0      ));
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2( offset.x,  -offset.y )) * 2.0;
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2( 0.0,        -offset2.y));
            sum += SAMPLE_TEXTURE2D_X(_BlitTexture, sampler_LinearClamp, uv + float2(-offset.x,  -offset.y )) * 2.0;

            return sum * (1.0 / 12.0);
        }
        ENDHLSL

        // ==========================================================
        // Pass 0: Downsample
        // ==========================================================
        Pass
        {
            Name "KawaseDownsample"
            HLSLPROGRAM
            #pragma vertex Vert // Blit.hlsl이 제공하는 완벽한 버텍스 함수 사용
            #pragma fragment fragDown
            ENDHLSL
        }

        // ==========================================================
        // Pass 1: Upsample
        // ==========================================================
        Pass
        {
            Name "KawaseUpsample"
            HLSLPROGRAM
            #pragma vertex Vert // Blit.hlsl이 제공하는 완벽한 버텍스 함수 사용
            #pragma fragment fragUp
            ENDHLSL
        }
    }
}
using UnityEngine;
using UnityEngine.UI;

[RequireComponent(typeof(RawImage))]
[RequireComponent(typeof(Shadow))]
public class SpatialUILight : MonoBehaviour
{
    [Header("Lighting Settings")]
    public float shadowSpread = 1f; // 인스펙터에서 1 내외로 조절하세요

    [Header("AR Settings")]
    [Tooltip("체크 시 사용자를 좌우(Y축)로만 따라다닙니다.")]
    public bool enableBillboard = true; // YAxisOnly 모드를 끄고 켤 수만 있게 단순화!

    private RawImage rawImage;
    private Shadow dropShadow;
    private Transform mainCamera;

    private int lightAngleID = Shader.PropertyToID("_Light_Angle");

    void Start()
    {
        rawImage = GetComponent<RawImage>();
        dropShadow = GetComponent<Shadow>();
        mainCamera = Camera.main.transform;
    }

    void Update()
    {
        if (mainCamera == null || rawImage.material == null) return;

        // =========================================================
        // 🌟 1. 빌보드 처리 (Y축 회전 전용 - 조명 효과 보존)
        // =========================================================
        if (enableBillboard)
        {
            Vector3 camForward = mainCamera.forward;
            camForward.y = 0; // 위아래 회전값은 0으로 만들어버림 (좌우만 따라감)

            if (camForward != Vector3.zero)
            {
                transform.forward = camForward.normalized;
            }
        }

        // =========================================================
        // 2. 카메라 방향 벡터 계산 및 로컬 변환
        // =========================================================
        Vector3 dirToCamera = mainCamera.position - transform.position;
        Vector3 localDir = transform.InverseTransformDirection(dirToCamera).normalized;

        // 3. 그림자 패럴랙스 (거리 제한 추가)
        float clampedX = Mathf.Clamp(-localDir.x * shadowSpread, -1f, 1f);
        float clampedY = Mathf.Clamp(-localDir.y * shadowSpread, -1f, 1f);
        dropShadow.effectDistance = new Vector2(clampedX, clampedY);

        // 4. 셰이더 림 라이트 처리 (각도 계산)
        float angle = Mathf.Atan2(localDir.y, localDir.x) * Mathf.Rad2Deg;
        if (angle < 0) angle += 360f;

        rawImage.material.SetFloat(lightAngleID, angle);
    }
}
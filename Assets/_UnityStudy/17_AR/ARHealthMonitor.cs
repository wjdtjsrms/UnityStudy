using System.Collections.Generic;
using Unity.Collections;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

#if UNITY_IOS && !UNITY_EDITOR
using UnityEngine.XR.ARKit;
#endif

public class ARHealthMonitor : MonoBehaviour
{
    [Header("Refs")]
    public ARSession arSession;
    public ARCameraManager cameraManager;
    public ARAnchor anchorToWatch; // 이미지 트래킹으로 생성한 앵커 할당
    public ARPointCloudManager pointCloudManager; // 선택 (피처 포인트 밀도 모니터)

    [Header("Jitter/Drift Settings")]
    public int poseWindow = 60;               // 최근 프레임 수
    public float jitterWarnRmsPosition = 0.01f; // 1cm 이상 RMS면 경고
    public float jitterWarnRmsRotationDeg = 1.0f;
    public float driftWarnFromInitial = 0.05f;  // 초기 위치에서 5cm 이상 벗어나면 경고
    public float driftWarnRotFromInitialDeg = 3.0f;

    private Queue<Vector3> recentPositions = new Queue<Vector3>();
    private Queue<Quaternion> recentRotations = new Queue<Quaternion>();
    private Vector3 initialPos;
    private Quaternion initialRot;
    private bool initialized;

    void OnEnable()
    {
        ARSession.stateChanged += OnARSessionStateChanged;
        if (cameraManager != null) cameraManager.frameReceived += OnFrame;
    }

    void OnDisable()
    {
        ARSession.stateChanged -= OnARSessionStateChanged;
        if (cameraManager != null) cameraManager.frameReceived -= OnFrame;
    }

    void OnARSessionStateChanged(ARSessionStateChangedEventArgs args)
    {
        // 원하면 여기서 UI 갱신
        Debug.Log($"[AR] SessionState: {ARSession.state}, NotTrackingReason: {ARSession.notTrackingReason}");
    }

    void OnFrame(ARCameraFrameEventArgs args)
    {
        if (anchorToWatch == null) return;

        // 앵커 추적 상태 체크
        var aState = anchorToWatch.trackingState; // Tracking / Limited / None

        // 초기 포즈 저장
        if (!initialized && aState == TrackingState.Tracking)
        {
            initialPos = anchorToWatch.transform.position;
            initialRot = anchorToWatch.transform.rotation;
            initialized = true;
        }

        if (!initialized) return;

        // 슬라이딩 윈도우 업데이트
        var p = anchorToWatch.transform.position;
        var r = anchorToWatch.transform.rotation;

        recentPositions.Enqueue(p);
        recentRotations.Enqueue(r);
        while (recentPositions.Count > poseWindow) recentPositions.Dequeue();
        while (recentRotations.Count > poseWindow) recentRotations.Dequeue();

        // 지터(RMS) 계산
        float rmsPos = ComputeRmsPosition(recentPositions);
        float rmsRotDeg = ComputeRmsRotationDeg(recentRotations);

        // 초기 포즈 대비 드리프트 계산
        float driftPos = Vector3.Distance(p, initialPos);
        float driftRotDeg = Quaternion.Angle(r, initialRot);

        // 포인트클라우드 밀도(선택)
        int featureCount = EstimatePointFeatureCount();

        // (iOS) 월드 매핑 상태
        string worldMapping = "N/A";
#if UNITY_IOS && !UNITY_EDITOR
        var sub = (ARKitSessionSubsystem)ARSession.subsystem;
        if (sub != null) worldMapping = sub.worldMappingStatus.ToString();
#endif

        // 요약 로그(또는 UI 표출)
        Debug.Log(
            $"[AR Health] Session={ARSession.state} ({ARSession.notTrackingReason}), " +
            $"Anchor={aState}, JitterRMS={rmsPos:F3}m / {rmsRotDeg:F1}°, " +
            $"Drift={driftPos:F3}m / {driftRotDeg:F1}°, " +
            $"FeatPts≈{featureCount}, WorldMap(iOS)={worldMapping}"
        );

        // 간단한 규칙 기반 ‘안정/불안정’ 판단
        bool sessionGood = ARSession.state == ARSessionState.SessionTracking && ARSession.notTrackingReason == NotTrackingReason.None;
        bool anchorGood = aState == TrackingState.Tracking;
        bool jitterOk = rmsPos <= jitterWarnRmsPosition && rmsRotDeg <= jitterWarnRmsRotationDeg;
        bool driftOk = driftPos <= driftWarnFromInitial && driftRotDeg <= driftWarnRotFromInitialDeg;

        if (sessionGood && anchorGood && jitterOk && driftOk)
        {
            // Stable
        }
        else
        {
            // Unstable → UI로 경고 띄우기 등
        }
    }

    float ComputeRmsPosition(Queue<Vector3> samples)
    {
        if (samples.Count < 2) return 0f;
        // 평균
        Vector3 mean = Vector3.zero;
        foreach (var v in samples) mean += v;
        mean /= samples.Count;

        // 제곱합
        float sumSq = 0f;
        foreach (var v in samples) sumSq += (v - mean).sqrMagnitude;

        // RMS = sqrt(variance)
        float variance = sumSq / samples.Count;
        return Mathf.Sqrt(variance);
    }

    float ComputeRmsRotationDeg(Queue<Quaternion> samples)
    {
        if (samples.Count < 2) return 0f;
        // 평균 회전은 간단히 기준(첫 샘플) 대비 평균 각도로 근사
        Quaternion first = default;
        bool firstSet = false;
        float sumAngles = 0f;
        int n = 0;
        foreach (var q in samples)
        {
            if (!firstSet) { first = q; firstSet = true; continue; }
            sumAngles += Quaternion.Angle(first, q);
            n++;
        }
        return n > 0 ? sumAngles / n : 0f;
    }

    int EstimatePointFeatureCount()
    {
        if (pointCloudManager == null) return -1;
        int total = 0;
        //foreach (var pc in pointCloudManager.trackables)
        //{
        //    var data = pc.positions;
        //    if (data.IsCreated) total += data.Length;
        //}
        return total;
    }
}
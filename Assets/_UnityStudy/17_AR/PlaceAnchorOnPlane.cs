using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems; // TrackableType을 사용하기 위해 필요
using System.Collections.Generic; // List를 사용하기 위해 필요

// ARRaycastManager와 ARAnchorManager가 같은 게임 오브젝트에 있어야 함을 강제
[RequireComponent(typeof(ARRaycastManager))]
[RequireComponent(typeof(ARAnchorManager))]
public class PlaceAnchorOnPlane : MonoBehaviour
{
    public ARCameraManager CameraManager;

    // 인스펙터에서 설정: 앵커에 고정시킬 프리팹 (예: 큐브, 의자 모델 등)
    public GameObject prefabToPlace;

    // AR 매니저들에 대한 참조
    private ARRaycastManager raycastManager;
    private ARAnchorManager anchorManager;

    private List<ARAnchor> arAnchors = new();

    // 레이캐스트 결과를 저장할 리스트 (매번 생성하지 않고 재사용하여 성능 최적화)
    private List<ARRaycastHit> hits = new List<ARRaycastHit>();

    void Awake()
    {
        // 컴포넌트 참조 가져오기
        raycastManager = GetComponent<ARRaycastManager>();
        anchorManager = GetComponent<ARAnchorManager>();
    }

    void Update()
    {
#if UNITY_EDITOR
        if (Input.GetMouseButtonDown(0))
        {
            Vector2 touchPosition = Input.mousePosition;

            if (raycastManager.Raycast(touchPosition, hits, TrackableType.PlaneWithinPolygon))
            {
                TryAddAnchor(hits[0].pose);
            }
        }
#endif

        // 1. 화면에 터치 입력이 있는지 확인 (터치가 시작되는 순간)
        if (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Began)
        {
            // 2. 터치한 화면 좌표 가져오기
            Vector2 touchPosition = Input.GetTouch(0).position;

            // 3. AR Raycast 수행
            //    TrackableType.PlaneWithinPolygon: 경계가 있는 ARPlane 내부만 히트 대상으로 함
            if (raycastManager.Raycast(touchPosition, hits, TrackableType.PlaneWithinPolygon))
            {
                TryAddAnchor(hits[0].pose);
            }
        }

        Debug.Log($"NotTrackingReason: {ARSession.notTrackingReason}");

        foreach (var anchor in arAnchors)
        {
            Debug.Log($"Tracking State : {anchor.name} {anchor.trackingState}");
        }
    }

    int anchorCount = 0;

    private async void TryAddAnchor(Pose hitPose)
    {
        // 5. ARAnchorManager를 사용해 앵커 생성
        //    앵커는 AR 시스템이 실제 공간의 특정 지점을 계속 추적하도록 보장합니다.
        var result = await anchorManager.TryAddAnchorAsync(hitPose);

        if (result.value != null)
        {
            anchorCount++;
            result.value.name = $"Anchor{anchorCount}";
            arAnchors.Add(result.value);

            // 6. 앵커가 성공적으로 생성되었는지 확인
            if (prefabToPlace != null)
            {
                // 7. 지정된 프리팹을 앵커의 자식으로 생성
                //    이렇게 하면 프리팹이 앵커를 따라다니며 실제 공간에 고정됩니다.
                Instantiate(prefabToPlace, result.value.transform);
                Debug.Log("앵커 및 프리팹 생성 완료.");
            }
            else
            {
                Debug.Log("앵커는 생성되었으나, 배치할 프리팹이 지정되지 않았습니다.");
            }
        }
        else
        {
            Debug.LogWarning("앵커 생성에 실패했습니다.");
        }
    }
}
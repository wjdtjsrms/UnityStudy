using System.Collections;
using UnityEngine;
using UnityEngine.EventSystems;

public class StickerItem : MonoBehaviour, IBeginDragHandler, IDragHandler, IEndDragHandler
{
    [SerializeField] GameObject stickerPrefab;
    [SerializeField] Camera mainCamera;

    PointerEventData currentDragData;
    GameObject stickerInstance;
    RaycastHit hitInfo;

    bool isStartDrag = false;
    const float LERP_SPEED = 10f;

    void Awake()
    {
        if (mainCamera == null)
            mainCamera = Camera.main;
    }

    public void OnBeginDrag(PointerEventData eventData)
    {
        stickerInstance = Instantiate(stickerPrefab);

        Vector3 screenPos = new(eventData.position.x, eventData.position.y, mainCamera.transform.forward.z);
        stickerInstance.transform.SetPositionAndRotation(mainCamera.ScreenToWorldPoint(screenPos), mainCamera.transform.rotation);

        isStartDrag = true;
        currentDragData = eventData;
        StartCoroutine(MoveDragPosition());
    }

    public void OnDrag(PointerEventData eventData)
    {
        currentDragData = eventData;
    }

    public void OnEndDrag(PointerEventData eventData)
    {
        isStartDrag = false;

        if (hitInfo.collider != null)
        {
            stickerInstance.transform.SetParent(hitInfo.collider.transform);
            stickerInstance.transform.position = hitInfo.point;
        }
        else
            Destroy(stickerInstance);
    }

    IEnumerator MoveDragPosition()
    {
        while (isStartDrag)
        {
            if (Physics.Raycast(mainCamera.ScreenPointToRay(currentDragData.position), out hitInfo, 1 << LayerMask.NameToLayer("Sticker")))
            {
                var lerpPos = Vector3.Lerp(stickerInstance.transform.position, hitInfo.point, Time.deltaTime * LERP_SPEED);
                stickerInstance.transform.SetPositionAndRotation(lerpPos, hitInfo.collider.transform.rotation);
            }
            else
            {
                Vector3 screenPos = new(currentDragData.position.x, currentDragData.position.y, mainCamera.transform.forward.z);
                var lerpPos = Vector3.Lerp(stickerInstance.transform.position, mainCamera.ScreenToWorldPoint(screenPos), Time.deltaTime * LERP_SPEED);

                stickerInstance.transform.SetPositionAndRotation(lerpPos, mainCamera.transform.rotation);
            }

            yield return null;
        }
    }
}

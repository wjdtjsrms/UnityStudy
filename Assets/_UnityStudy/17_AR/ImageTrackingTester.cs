using UnityEngine;
using UnityEngine.XR.ARFoundation;

public class ImageTrackingTester : MonoBehaviour
{
    ARTrackedImageManager imageManager;
    [SerializeField] Material trackingMat, limitedMat;

    private void OnEnable()
    {
        imageManager = GetComponent<ARTrackedImageManager>();
        imageManager.trackablesChanged.AddListener(ChangedImageTrackable);
    }

    private void OnDisable()
    {
        imageManager.trackablesChanged.RemoveListener(ChangedImageTrackable);
    }

    void ChangedImageTrackable(ARTrackablesChangedEventArgs<ARTrackedImage> args)
    {
        foreach (var updateImage in args.updated)
        {
            if (updateImage.trackingState == UnityEngine.XR.ARSubsystems.TrackingState.Tracking)
            {
                updateImage.GetComponent<Renderer>().material =
                    updateImage.trackingState == UnityEngine.XR.ARSubsystems.TrackingState.Tracking ? trackingMat : limitedMat;
            }
        }
    }
}

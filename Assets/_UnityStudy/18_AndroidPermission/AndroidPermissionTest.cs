using UnityEngine;
using UnityEngine.Android;

public class AndroidPermissionTest : MonoBehaviour
{
    private const string PREF_DENIED_ONCE = "CameraPermissionDeniedOnce";

    public void RequestPermission()
    {
        if (Permission.HasUserAuthorizedPermission(Permission.Camera))
        {
            PlayerPrefs.DeleteKey(PREF_DENIED_ONCE);
            Debug.Log("Already Has Permission");
        }
        else
        {
            RequestCameraPermission();
        }
    }

    public void CanShowSystemPopup()
    {
        if (Permission.HasUserAuthorizedPermission(Permission.Camera))
        {
            // return false;
        }

        bool canShowSystemPopup = PlayerPrefs.GetInt(PREF_DENIED_ONCE, 0) == 0 || Permission.ShouldShowRequestPermissionRationale((Permission.Camera));
        Debug.Log($"CanShowSystemPopup : {canShowSystemPopup}");
    }

    private void RequestCameraPermission()
    {
        var callbacks = new PermissionCallbacks();

        callbacks.PermissionGranted += (permissionName) =>
        {
            Debug.Log($"{permissionName} 권한 승인");
            PlayerPrefs.DeleteKey(PREF_DENIED_ONCE);
        };

        callbacks.PermissionDenied += (permissionName) =>
        {
            Debug.Log($"{permissionName} 권한 거절");
            CheckDenialType(permissionName);
        };

        Permission.RequestUserPermission(Permission.Camera, callbacks);
    }

    private void CheckDenialType(string permissionName)
    {
        if (!Permission.ShouldShowRequestPermissionRationale(permissionName))
        {
            bool hasDeniedOnce = PlayerPrefs.GetInt(PREF_DENIED_ONCE, 0) == 1;

            if (hasDeniedOnce)
                Debug.LogWarning("영구 거절됨: 설정 창으로 유도 필요");
            else
                Debug.Log("단순 거절 또는 취소됨: 재요청 가능");
        }
        else
        {
            PlayerPrefs.SetInt(PREF_DENIED_ONCE, 1);
            PlayerPrefs.Save();

            Debug.Log("단순 거절 또는 취소됨: 재요청 가능");
        }
    }
}

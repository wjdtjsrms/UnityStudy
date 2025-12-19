using UnityEngine;

namespace Anipen.Devmodule.Example
{
    public interface IExampleUIManager
    {
        void ShowWindow(string name);
        void HideWindow(string name);
        GameObject GetWindow(string name);
    }
}
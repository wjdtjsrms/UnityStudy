namespace Anipen.Devmodule.Example
{
    using System.Collections.Generic;
    using UnityEngine;

    public class ExampleUIManager : MonoBehaviour, IExampleUIManager
    {
        [SerializeField] List<GameObject> Panels;

        public void ShowWindow(string name)
        {
            Panels.Find((obj) => obj.name == name)?.gameObject.SetActive(true);
        }

        public void HideWindow(string name)
        {
            Panels.Find((obj) => obj.name == name)?.gameObject.SetActive(false);
        }

        public GameObject GetWindow(string name)
        {
            return Panels.Find((obj) => obj.name == name);
        }
    }
}
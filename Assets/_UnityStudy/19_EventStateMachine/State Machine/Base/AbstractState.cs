namespace Anipen.Devmodule
{
    using System.Collections.Generic;
    using UnityEngine;

    public abstract class AbstractState : IState
    {
        readonly List<ILink> links = new();

        public virtual string Name { get; set; }
        public bool DebugEnabled { get; set; } = false;

        public virtual void Enter() { }

        public abstract bool Execute();

        public virtual void Exit() { }

        public void AddLink(ILink link)
        {
            if (!links.Contains(link))
                links.Add(link);
        }

        public void RemoveLink(ILink link)
        {
            if (links.Contains(link))
                links.Remove(link);
        }

        public void RemoveAllLinks()
        {
            links.Clear();
        }

        public bool TryTransition(out IState nextState)
        {
            if (links.Count > 0)
            {
                foreach (var link in links)
                {
                    var result = link.Validate(out nextState);
                    if (result)
                        return true;
                }
            }

            nextState = null;
            return false;
        }

        public void EnableLinks()
        {
            foreach (var link in links)
                link.Enable();
        }

        public void DisableLinks()
        {
            foreach (var link in links)
                link.Disable();
        }

        public virtual void LogCurrentState()
        {
            if (DebugEnabled)
                Debug.Log("Current state = " + Name + "(" + this.GetType().Name + ")");
        }
    }
}
namespace Anipen.Devmodule
{
    using UnityEngine;

    public class Link : ILink
    {
        readonly IState nextState;

        public Link(IState _nextState)
        {
            nextState = _nextState;
        }

        public bool Validate(out IState _nextState)
        {
            _nextState = nextState;
            return true;
        }
    }
}
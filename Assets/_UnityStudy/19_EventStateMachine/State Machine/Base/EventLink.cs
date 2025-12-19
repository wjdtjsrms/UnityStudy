namespace Anipen.Devmodule
{
    using System;

    public class ActionWrapper
    {
        public Action<Action> Subscribe;
        public Action<Action> Unsubscribe;
    }

    public class EventLink : ILink
    {
        readonly IState nextState;
        readonly ActionWrapper actionWrapper;

        bool eventRaised = false;

        public EventLink(ActionWrapper _actionWrapper, IState _nextState)
        {
            actionWrapper = _actionWrapper;
            nextState = _nextState;
        }

        public bool Validate(out IState _nextState)
        {
            _nextState = eventRaised ? nextState : null;
            return eventRaised;
        }

        public void Enable()
        {
            actionWrapper.Subscribe(OnEventRaised);
            eventRaised = false;
        }

        public void Disable()
        {
            actionWrapper.Unsubscribe(OnEventRaised);
            eventRaised = false;
        }

        void OnEventRaised()
        {
            eventRaised = true;
        }
    }
}
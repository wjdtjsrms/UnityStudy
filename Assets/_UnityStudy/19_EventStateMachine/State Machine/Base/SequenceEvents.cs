using System;
using Unity.Mathematics;

namespace Anipen.Devmodule
{
    public class SequenceEvents
    {
        Action moveNextState;
        Action moveBackState;
        Action moveBackHistoryState;
        Action successAction;
        Action faildAction;
        Action moveSettingState;


        readonly ActionWrapper moveNextStateWrapper;
        readonly ActionWrapper moveBackStateWrapper;
        readonly ActionWrapper successActionWrapper;
        readonly ActionWrapper faildActionWrapper;
        readonly ActionWrapper moveBackHistoryStateWrapper;
        readonly ActionWrapper moveSettingStateWrapper;

        public ActionWrapper MoveNextStateWrapper => moveNextStateWrapper;
        public ActionWrapper MoveBackStateWrapper => moveBackStateWrapper;
        public ActionWrapper SuccessActionWrapper => successActionWrapper;
        public ActionWrapper FaildActionWrapper => faildActionWrapper;
        public ActionWrapper MoveBackHistoryStateWrapper => moveBackHistoryStateWrapper;
        public ActionWrapper MoveSettingStateWrapper => moveSettingStateWrapper;

        public void InvokeMoveNextState() => moveNextState?.Invoke();
        public void InvokeMoveBackState() => moveBackState?.Invoke();
        public void InvokeSuccessAction() => successAction?.Invoke();
        public void InvokeFaildAction() => faildAction?.Invoke();
        public void InvokeMoveBackHistory() => moveBackHistoryState?.Invoke();
        public void InvokeMoveSettingState() => moveSettingState?.Invoke();

        public SequenceEvents()
        {
            moveNextStateWrapper = new()
            {
                Subscribe = handler => moveNextState += handler,
                Unsubscribe = handler => moveNextState -= handler,
            };

            moveBackStateWrapper = new()
            {
                Subscribe = handler => moveBackState += handler,
                Unsubscribe = handler => moveBackState -= handler,
            };

            successActionWrapper = new()
            {
                Subscribe = handler => successAction += handler,
                Unsubscribe = handler => successAction -= handler,
            };

            faildActionWrapper = new()
            {
                Subscribe = handler => faildAction += handler,
                Unsubscribe = handler => faildAction -= handler,
            };

            moveBackHistoryStateWrapper = new()
            {
                Subscribe = handler => moveBackHistoryState += handler,
                Unsubscribe = handler => moveBackHistoryState -= handler,
            };

            moveSettingStateWrapper = new()
            {
                Subscribe = handler => moveSettingState += handler,
                Unsubscribe = handler => moveSettingState -= handler,
            };
        }
    }
}
using Cysharp.Threading.Tasks;
using System;
using System.Threading;

namespace Anipen.Devmodule
{
    public class StateMachine : IDisposable
    {
        private bool isMachineRunning = false;

        private CancellationTokenSource currentStateCTS = null;

        private IState pendingForcedState = null;

        public IState CurrentState { get; private set; } = null;

        public void Dispose() => StopStateMachine();

        #region Public Methods
        public void StartStateMachine(IState initialState)
        {
            if (isMachineRunning || initialState == null) return;

            isMachineRunning = true;
            CurrentState = initialState;

            RunStateMachineLoop().Forget();
        }

        public void StopStateMachine()
        {
            if (!isMachineRunning) return;

            isMachineRunning = false;

            CancelCurrentState();
        }

        public void ForceChangeState(IState urgentState)
        {
            if (!isMachineRunning) return;

            pendingForcedState = urgentState;

            CancelCurrentState();
        }
        #endregion

        #region Core Loop
        private async UniTaskVoid RunStateMachineLoop()
        {
            while (isMachineRunning && CurrentState != null)
            {
                bool isCancelled = await ExcuteCurrentState();
                MoveNextState(isCancelled);
            }    
        }

        private async UniTask<bool> ExcuteCurrentState()
        {
            CurrentState.EnableLinks();
            CurrentState.Enter();

            currentStateCTS = new CancellationTokenSource();
            bool isCancelled = false;

            isCancelled = await UniTask.WaitUntil(() => CurrentState.Execute(), PlayerLoopTiming.Update, currentStateCTS.Token).SuppressCancellationThrow();

            if (!isCancelled)
                isCancelled = await UniTask.WaitUntil(() => CurrentState.TryTransition(out _), PlayerLoopTiming.Update, currentStateCTS.Token).SuppressCancellationThrow();

            return isCancelled;
        }

        private void MoveNextState(bool isCancelled)
        {
            IState nextState = null;

            if (pendingForcedState != null)
            {
                nextState = pendingForcedState;
                pendingForcedState = null;
            }
            else if (!isCancelled)
            {
                if (CurrentState.TryTransition(out var linkedState))
                    nextState = linkedState;
            }

            CurrentState.Exit();
            CurrentState.DisableLinks();

            CurrentState = nextState;
        }
        #endregion

        #region Control State Machine
        private void CancelCurrentState()
        {
            if (currentStateCTS == null) return;

            currentStateCTS.Cancel();
            currentStateCTS.Dispose();
            currentStateCTS = null;
        }
        #endregion
    }
}

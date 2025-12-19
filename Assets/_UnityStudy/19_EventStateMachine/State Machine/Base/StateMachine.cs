using Cysharp.Threading.Tasks;
using System;
using System.Collections.Generic;
using System.Threading;

namespace Anipen.Devmodule
{
    public class StateMachine : IDisposable
    {
        bool isStateActive = false;
        bool isMachineRunning = false;

        CancellationTokenSource stateCancellationTokenSource = null;

        public IState CurrentState { get; private set; } = null;
        private readonly Stack<IState> stateHistory = new Stack<IState>();

        public void Dispose()
        {
            StopStateMachine();
        }

        #region Control State Machine
        public void StartStateMachine(IState initialState)
        {
            if (isMachineRunning) return;

            ChangeState(initialState);
            StartTransitionLoopAsync().Forget();
        }

        public void StopStateMachine()
        {
            if (!isMachineRunning) return;

            if (CurrentState != null && isStateActive)
                CancelCurrentState();

            isMachineRunning = false;
            CurrentState = null;
        }

        async UniTask StartTransitionLoopAsync()
        {
            isMachineRunning = true;

            while (isMachineRunning)
            {
                CheckForValidTransitions();
                await UniTask.Yield(PlayerLoopTiming.LastUpdate);
            }
        }

        void CheckForValidTransitions()
        {
            if (CurrentState != null && !isStateActive)
            {
                if (CurrentState.TryTransition(out var nextState))
                {
                    UnlinkCurrentState();

                    ChangeState(nextState);
                    CurrentState.EnableLinks();
                }
            }
        }
        #endregion

        #region Control State
        void UnlinkCurrentState()
        {
            if (CurrentState != null)
            {
                CurrentState.Exit();
                CurrentState.DisableLinks();
            }
        }
        void ChangeState(IState nextState, bool recordHistory = false)
        {
            if (nextState == null)
                throw new ArgumentNullException(nameof(nextState));

            if (CurrentState != null && isStateActive)
                CancelCurrentState();

            if (recordHistory)
                stateHistory.Push(CurrentState);

            CurrentState = nextState;
            CurrentState.EnableLinks();
            ExecuteStateAsync().Forget();
        }

        public void MoveState(IState state) => ChangeState(state, recordHistory: true);

        public void MoveBackState()
        {
            if (stateHistory.Count > 0)
            {
                IState previousState = stateHistory.Pop();
                if (CurrentState != null && isStateActive)
                    CancelCurrentState();

                UnlinkCurrentState();
                CurrentState = previousState;
                CurrentState.EnableLinks();
                ExecuteStateAsync().Forget();
            }
        }

        async UniTask ExecuteStateAsync()
        {
            if (isStateActive) return;

            isStateActive = true;
            stateCancellationTokenSource = new CancellationTokenSource();

            CurrentState.Enter();

            await UniTask.WaitUntil(() => CurrentState.Execute(), PlayerLoopTiming.Update, stateCancellationTokenSource.Token)
                .SuppressCancellationThrow();

            isStateActive = false;
        }

        void CancelCurrentState()
        {
            if (stateCancellationTokenSource != null)
            {
                stateCancellationTokenSource.Cancel();
                stateCancellationTokenSource.Dispose();
                stateCancellationTokenSource = null;
            }

            CurrentState.Exit();

            isStateActive = false;
        }
        #endregion
    }
}

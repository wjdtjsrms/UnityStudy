namespace Anipen.Devmodule
{
    using Cysharp.Threading.Tasks;
    using System.Threading;
    using UnityEngine;
    using VContainer;

    public class DelayState : State
    {
        protected bool isFinish = false;
        protected CancellationTokenSource stateCancellationTokenSource = null;

        public override void Enter()
        {
            base.Enter();

            isFinish = false;
            stateCancellationTokenSource = new CancellationTokenSource();

            DelayExcute().Forget();
        }

        public override bool Execute()
        {
            return base.Execute() && isFinish;
        }

        public override void Exit()
        {
            base.Exit();

            if (!isFinish && stateCancellationTokenSource != null)
                stateCancellationTokenSource.Cancel();

            stateCancellationTokenSource.Dispose();
            stateCancellationTokenSource = null;
        }

        protected virtual async UniTask DelayExcute()
        {
            await UniTask.Delay(1, false, PlayerLoopTiming.Update, stateCancellationTokenSource.Token).SuppressCancellationThrow();

            isFinish = true;
        }
    }
}
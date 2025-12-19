using Cysharp.Threading.Tasks;

namespace Anipen.Devmodule
{
    public interface IState
    {
        void Enter();
        bool Execute();
        void Exit();

        void AddLink(ILink link);
        void RemoveLink(ILink link);
        void RemoveAllLinks();

        bool TryTransition(out IState nextState);
        void EnableLinks();
        void DisableLinks();
    }
}

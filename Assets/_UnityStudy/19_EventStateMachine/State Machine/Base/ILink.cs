namespace Anipen.Devmodule
{
    public interface ILink
    {
        bool Validate(out IState _nextState);

        void Enable() { }
        void Disable() { }
    }
}
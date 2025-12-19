using VContainer;

namespace Anipen.Devmodule
{
    public class State : AbstractState
    {
        public State SetStateName(string stateName)
        {
            Name = stateName;
            return this;
        }

        public State EnableDebug(bool enabledDebug)
        {
            DebugEnabled = enabledDebug;
            return this;
        }

        public override bool Execute()
        {
            if (DebugEnabled)
                base.LogCurrentState();

            return true;
        }
    }
}
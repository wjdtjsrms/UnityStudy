namespace Anipen.Devmodule.Example
{
    using VContainer;
    using VContainer.Unity;

    public class ExampleSequenceManager : IStartable
    {
        readonly StateMachine stateMachine;
        readonly SequenceEvents sequenceEvents;

        readonly IObjectResolver objectResolver;

        IState splashScreenState, startScreenState, checkMaintenanceState, mainMenuState;

        [Inject]
        public ExampleSequenceManager(IObjectResolver _objectResolver, SequenceEvents _sequenceEvents)
        {
            objectResolver = _objectResolver;
            sequenceEvents = _sequenceEvents;

            stateMachine = new();

            SetStates();
            AddLinks();
        }

        public void Start()
        {
            stateMachine.StartStateMachine(splashScreenState);
        }

        private void SetStates()
        {
            splashScreenState = new SplashScreenState(objectResolver).EnableDebug(true);
            startScreenState = new StartScreenState(objectResolver).EnableDebug(true);
            checkMaintenanceState = new CheckMaintenanceState(objectResolver).EnableDebug(true);
            mainMenuState = new MainMenuState(objectResolver).EnableDebug(true);
        }

        private void AddLinks()
        {
            //              Waiting 3 seconds               Press Button                         Press S
            //  splashScreen ==============> startScreen ==================> checkMaintenance ============> mainMenu
            //                                                                    Press F                      | Press Button
            //             <====================================================================================

            splashScreenState.AddLink(new Link(startScreenState));

            startScreenState.AddLink(new EventLink(sequenceEvents.MoveNextStateWrapper, checkMaintenanceState));

            checkMaintenanceState.AddLink(new EventLink(sequenceEvents.SuccessActionWrapper, mainMenuState));
            checkMaintenanceState.AddLink(new EventLink(sequenceEvents.FaildActionWrapper, splashScreenState));

            mainMenuState.AddLink(new EventLink(sequenceEvents.MoveNextStateWrapper, splashScreenState));
        }
    }
}
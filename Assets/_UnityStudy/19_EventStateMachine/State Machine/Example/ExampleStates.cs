using TMPro;
using UnityEngine;
using UnityEngine.UI;
using VContainer;

namespace Anipen.Devmodule.Example
{
    public class SplashScreenState : State
    {
        readonly IExampleUIManager uIManager;
        readonly TextMeshProUGUI deltaTimeText;

        float deltaTime;
        const float DELAY_TIME = 3f;

        public SplashScreenState(IObjectResolver objectResolver)
        {
            uIManager = objectResolver.Resolve<IExampleUIManager>();
            deltaTimeText = uIManager.GetWindow("SplashScreen").GetComponentInChildren<TextMeshProUGUI>();
        }

        public override void Enter()
        {
            base.Enter();

            uIManager.ShowWindow("SplashScreen");

            deltaTime = 0f;
            deltaTimeText.text = "0";
        }

        public override bool Execute()
        {
            deltaTime += Time.deltaTime;
            deltaTimeText.text = $"{deltaTime}";

            return base.Execute() && deltaTime > DELAY_TIME;
        }

        public override void Exit()
        {
            base.Exit();
            uIManager.HideWindow("SplashScreen");
        }
    }

    public class StartScreenState : State
    {
        readonly IExampleUIManager uIManager;
        readonly SequenceEvents mainSequenceEvents;
        readonly Button button;

        public StartScreenState(IObjectResolver objectResolver)
        {
            uIManager = objectResolver.Resolve<IExampleUIManager>();
            mainSequenceEvents = objectResolver.Resolve<SequenceEvents>();

            button = uIManager.GetWindow("StartScreen").GetComponentInChildren<Button>();
            button.onClick.AddListener(mainSequenceEvents.InvokeMoveNextState);
        }

        public override void Enter()
        {
            base.Enter();
            uIManager.ShowWindow("StartScreen");
        }

        public override void Exit()
        {
            base.Exit();
            uIManager.HideWindow("StartScreen");
        }
    }

    public class CheckMaintenanceState : State
    {
        readonly IExampleUIManager uIManager;
        readonly SequenceEvents mainSequenceEvents;
        readonly Button[] buttons;

        public CheckMaintenanceState(IObjectResolver objectResolver)
        {
            uIManager = objectResolver.Resolve<IExampleUIManager>();
            mainSequenceEvents = objectResolver.Resolve<SequenceEvents>();

            buttons = uIManager.GetWindow("CheckMaintenance").GetComponentsInChildren<Button>();
        }

        public override void Enter()
        {
            base.Enter();

            uIManager.ShowWindow("CheckMaintenance");

            buttons[0].onClick.AddListener(mainSequenceEvents.InvokeSuccessAction);
            buttons[1].onClick.AddListener(mainSequenceEvents.InvokeFaildAction);
        }

        public override void Exit()
        {
            buttons[0].onClick.RemoveAllListeners();
            buttons[1].onClick.RemoveAllListeners();

            uIManager.HideWindow("CheckMaintenance");

            base.Exit();
        }
    }

    public class MainMenuState : State
    {
        readonly IExampleUIManager uIManager;
        readonly SequenceEvents mainSequenceEvents;
        readonly Button button;

        public MainMenuState(IObjectResolver objectResolver)
        {
            uIManager = objectResolver.Resolve<IExampleUIManager>();
            mainSequenceEvents = objectResolver.Resolve<SequenceEvents>();

            button = uIManager.GetWindow("MainMenu").GetComponentInChildren<Button>();
            button.onClick.AddListener(mainSequenceEvents.InvokeMoveNextState);
        }

        public override void Enter()
        {
            base.Enter();
            uIManager.ShowWindow("MainMenu");
        }

        public override void Exit()
        {
            uIManager.HideWindow("MainMenu");
            base.Exit();
        }
    }
}
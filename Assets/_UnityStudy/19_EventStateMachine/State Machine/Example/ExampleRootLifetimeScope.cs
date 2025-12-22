namespace Anipen.Devmodule.Example
{
    using VContainer;
    using VContainer.Unity;
    using UnityEngine;

    public class ExampleRootLifetimeScope : LifetimeScope
    {
        [SerializeField] private ExampleUIManager exampleUIManager;

        protected override void Configure(IContainerBuilder builder)
        {
            builder.RegisterEntryPoint<ExampleSequenceManager>(Lifetime.Scoped);
            builder.Register<SequenceEvents>(Lifetime.Scoped);

            builder.RegisterComponent<IExampleUIManager>(exampleUIManager);
        }
    }
}
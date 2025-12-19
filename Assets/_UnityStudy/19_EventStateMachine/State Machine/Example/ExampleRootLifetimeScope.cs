namespace Anipen.Devmodule.Example
{
    using VContainer;
    using VContainer.Unity;

    public class ExampleRootLifetimeScope : LifetimeScope
    {
        protected override void Configure(IContainerBuilder builder)
        {
            builder.RegisterComponentInHierarchy<IExampleUIManager>();

            builder.RegisterEntryPoint<ExampleSequenceManager>(Lifetime.Scoped);
            builder.Register<SequenceEvents>(Lifetime.Scoped);
        }
    }
}
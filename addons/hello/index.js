// Hibi calls this factory with its SDK, then calls start() when the addon turns on
// and stop() when it turns off. Everything start() registers must be undone in stop().
export default () => {
  const disposers = []
  return {
    async start(context) {
      // Saved settings survive restarts. Bump the version when the stored shape changes.
      const greetings = await context.storage.global('greetings', 1)
      disposers.push(
        context.commands.register({
          id: 'greet',
          label: 'Say hello',
          async run() {
            const current = greetings.snapshot()
            const count =
              (current.status === 'ready' ? current.value.count : 0) + 1
            await greetings.set({ count })
            context.notify(
              count === 1
                ? 'Hello from your Hibi addon.'
                : `Hello again. You have said hello ${count} times.`,
            )
          },
        }),
      )
    },
    stop() {
      for (const dispose of disposers.splice(0).reverse()) dispose()
    },
  }
}

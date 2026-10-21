// Trusted JavaScript handler fixture (not Oreslang actor source lowering).
export async function receive(message, self) {
  switch (message.type) {
    case 'add':
      self.respond(message.x + message.y); self.done(); return;
    case 'sleep':
      await new Promise(resolve => setTimeout(resolve, message.ms));
      self.respond(message.n); self.done(); return;
    case 'tell':
      self.done(); return;
    case 'crash':
      throw new Error('intentional handler error');
    case 'missing-done':
      return 42n; // A JS return MUST NOT count as an Oreslang actor reply.
    case 'no-reply':
      self.done(); return;
    default:
      throw new Error('unrecognized actor message');
  }
}

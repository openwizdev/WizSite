// FA3 (#1901): the Ask-a-Wiz function. Not built yet: the red run's stub.
export const rankPassages = () => [];
export async function handle() { return new Response(null, { status: 501 }); }
export const onRequest = context => handle(context);

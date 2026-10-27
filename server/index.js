import { createApp } from './app.js';

const port = process.env.PORT || 8080;
createApp().listen(port, () => console.log(`Listening on ${port}`));

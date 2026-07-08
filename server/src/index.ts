import { config } from 'dotenv';

import { startServer } from './http/server';

config({ quiet: true });

void startServer();

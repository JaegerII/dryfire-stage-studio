import { Config } from '@remotion/cli/config';

Config.setOverwriteOutput(true);
// WebGL in headless Chrome on Windows
Config.setChromiumOpenGlRenderer('angle');

import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: { ...current.resolve, extensionAlias: { ...current.resolve?.extensionAlias, ".js": [".ts", ".tsx", ".js"] } },
}));

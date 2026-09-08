# BlackWave 寰澜移动端

Expo SDK 57 + React Native 0.86。内部和生产构建使用原生移动端认证，支持密码登录、验证码登录、邀请注册、密码重置以及联系方式管理。

## 环境准备

1. 安装完整 Xcode，并至少安装一个 iOS 16.4 以上 Simulator Runtime。
2. 确认 Xcode 命令行路径：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
xcodebuild -version
xcrun simctl list devices available
```

3. 安装依赖并准备环境变量：

```bash
pnpm install
cp .env.example .env
```

默认 `EXPO_PUBLIC_API_URL=https://blackwave.org.cn/yuanji`，iOS Simulator 和实体设备使用同一套 HTTPS API。

## 环境与构建

| EAS profile | EAS environment | 鉴权 | 产物 |
|---|---|---|---|
| `development` | `development` | `legacy` | Development Build |
| `internal-ios` | `preview` | `mobile` | TestFlight / App Store 分发构建 |
| `internal-android` | `preview` | `mobile` | 签名 APK |
| `production` | `production` | `mobile` | 正式商店构建 |

在 EAS 的 `preview` 和 `production` environment 中分别配置 `EXPO_PUBLIC_API_URL`，并使用各自的外部服务应用配置。内部构建必须使用设备可访问的 HTTPS API，不能写 `127.0.0.1`、`localhost` 或开发者本机局域网地址。

`.env.preview.example` 和 `.env.production.example` 只包含无秘密的占位值，不能直接用于发布。真实 API 地址和外部服务凭证由对应 EAS environment 管理，不提交到仓库。

```bash
pnpm dlx eas-cli build --platform ios --profile internal-ios
pnpm dlx eas-cli build --platform android --profile internal-android
pnpm dlx eas-cli build --platform all --profile production
```

Android 内部版只生成 APK；本阶段不接入 Google Play、Firebase 或 FCM。

Android 原生目录由 Expo 预构建生成。`plugins/withAndroidNdkVersion.js` 会让 Android Library 子模块继承 React Native 的 NDK 版本；不要手工修改生成的 `android/` 目录。

## 启动

先启动 FastAPI 后端，再运行：

```bash
pnpm ios
```

也可以先启动 Metro，然后在终端选择 iOS：

```bash
pnpm start
```

## 检查

```bash
pnpm test --runInBand
pnpm typecheck
node --test scripts/eas-config.test.mjs
pnpm dlx expo-doctor
pnpm exec expo export --platform ios --output-dir /tmp/blackwave-ios-export
```

OpenAPI 类型生成现在跨仓库使用：

```bash
OPENAPI_URL=https://<api-domain>/openapi.json pnpm run generate:api
```

## Remote

创建远端仓库后执行：

```bash
git remote add origin <mobile-git-url>
git push -u origin main
```

## 鉴权边界

- `EXPO_PUBLIC_AUTH_MODE=legacy` 只保留给本地 development 构建。
- `EXPO_PUBLIC_APP_ENV=production` 与 `legacy` 同时出现时，App 会立即拒绝启动。
- `internal-ios`、`internal-android` 和 `production` 必须显式使用 `EXPO_PUBLIC_AUTH_MODE=mobile`。
- 服务端 `AUTH_CODE_LOGIN_REVEAL_UNKNOWN_CONTACT` 默认保持 `false`；仅在内部流程通过并经产品负责人批准后灰度开启。
- 关闭该服务端开关会恢复未知联系方式的虚拟挑战行为，不需要回滚移动端构建或数据库迁移。
- 验证码、验证令牌和密码只保留在当前页面内存，不写入离线缓存、日志或路由参数。

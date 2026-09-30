import { useCallback, useEffect, useRef } from 'react';
import * as ReactNative from 'react-native';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const blackWaveLogo = require('../../../assets/images/BWlogo.jpg');
const LOGO_ASPECT_RATIO = 1320 / 1307;
const LOGO_WIDTH_RATIO = 0.8;
const LOGO_CENTER_Y_RATIO = 0.5;

type StartupScreenProps = {
  onReady?: () => void;
};

export function StartupScreen({ onReady }: StartupScreenProps) {
  const { height, width } = ReactNative.useWindowDimensions();
  const logoScale = useRef(new Animated.Value(0)).current;
  const logoWidth = Math.round(width * LOGO_WIDTH_RATIO);
  const logoHeight = logoWidth / LOGO_ASPECT_RATIO;
  const logoTop = (height * LOGO_CENTER_Y_RATIO) - (logoHeight / 2);
  const handleLayout = useCallback(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    const animation = Animated.timing(logoScale, {
      duration: 3_000,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [logoScale]);

  return (
    <View onLayout={handleLayout} style={styles.screen} testID="startup-screen">
      <View style={[styles.content, { top: logoTop }]} testID="startup-content">
        <Animated.Image
          accessibilityLabel="BlackWave 启动标识"
          resizeMode="contain"
          source={blackWaveLogo}
          style={[
            styles.logo,
            {
              height: logoHeight,
              transform: [
                {
                  scale: logoScale.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.5],
                  }),
                },
              ],
              width: logoWidth,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#000000',
    flex: 1,
  },
  content: {
    alignItems: 'center',
    left: 0,
    paddingHorizontal: 24,
    position: 'absolute',
    right: 0,
  },
  logo: {
  },
});

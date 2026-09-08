import { Image, StyleSheet, View } from 'react-native';

const logo = require('../../../assets/images/BWlogoicon.jpg');

type BrandMarkProps = {
  size?: number;
  testID?: string;
};

export function BrandMark({ size = 54, testID = 'brand-mark' }: BrandMarkProps) {
  return (
    <View style={[styles.frame, { borderRadius: Math.min(8, size / 4), height: size, width: size }]} testID={testID}>
      <Image resizeMode="cover" source={logo} style={styles.logo} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    backgroundColor: '#000000',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: {
    height: '100%',
    width: '100%',
  },
});

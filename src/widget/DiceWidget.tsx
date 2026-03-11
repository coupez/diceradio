'use no memo';

import React from 'react';
import { FlexWidget, ImageWidget } from 'react-native-android-widget';

export function DiceWidget() {
  return (
    <FlexWidget
      clickAction="WIDGET_CLICK"
      clickActionData={{ action: 'roll' }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 0,
      }}
      accessibilityLabel="Roll chaotic Spotify radio"
    >
      <ImageWidget image={require('../../assets/dice-logo.png')} imageWidth={54} imageHeight={54} />
    </FlexWidget>
  );
}

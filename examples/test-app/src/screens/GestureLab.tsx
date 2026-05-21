import { useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import {
  Directions,
  FlingGestureHandler,
  PanGestureHandler,
  PinchGestureHandler,
  RotationGestureHandler,
  State,
  type FlingGestureHandlerStateChangeEvent,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
  type PinchGestureHandlerGestureEvent,
  type PinchGestureHandlerStateChangeEvent,
  type RotationGestureHandlerGestureEvent,
  type RotationGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';

import { SectionCard } from '../components';
import { useAppColors, type AppColors } from '../theme';

const gestureImageUri = 'https://reactnative.dev/img/logo-share.png';

type TransformState = {
  offsetX: number;
  offsetY: number;
  rotation: number;
  scale: number;
};

type GestureCounts = {
  fling: number;
};

const initialTransform: TransformState = {
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  scale: 1,
};

const initialCounts: GestureCounts = {
  fling: 0,
};
const minScale = 0.5;
const maxScale = 2;

export function GestureLab() {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [transform, setTransform] = useState<TransformState>(initialTransform);
  const [counts, setCounts] = useState<GestureCounts>(initialCounts);
  const transformRef = useRef<TransformState>(initialTransform);
  const gestureStartRef = useRef<TransformState>(initialTransform);
  const flingDownRef = useRef(null);
  const flingLeftRef = useRef(null);
  const flingRightRef = useRef(null);
  const flingUpRef = useRef(null);
  const panRef = useRef(null);
  const pinchRef = useRef(null);
  const rotationRef = useRef(null);
  const flingRefs = [flingLeftRef, flingRightRef, flingUpRef, flingDownRef];

  function updateTransform(nextTransform: TransformState) {
    transformRef.current = nextTransform;
    setTransform(nextTransform);
  }

  function beginTransformGesture() {
    gestureStartRef.current = transformRef.current;
  }

  function handlePan(event: PanGestureHandlerGestureEvent) {
    const start = gestureStartRef.current;
    updateTransform({
      ...transformRef.current,
      offsetX: clamp(start.offsetX + event.nativeEvent.translationX, -72, 72),
      offsetY: clamp(start.offsetY + event.nativeEvent.translationY, -56, 56),
    });
  }

  function handlePinch(event: PinchGestureHandlerGestureEvent) {
    const start = gestureStartRef.current;
    updateTransform({
      ...transformRef.current,
      scale: clamp(start.scale * event.nativeEvent.scale, minScale, maxScale),
    });
  }

  function handleRotation(event: RotationGestureHandlerGestureEvent) {
    const start = gestureStartRef.current;
    updateTransform({
      ...transformRef.current,
      rotation: start.rotation + event.nativeEvent.rotation,
    });
  }

  function handleTransformStateChange(
    event:
      | PanGestureHandlerStateChangeEvent
      | PinchGestureHandlerStateChangeEvent
      | RotationGestureHandlerStateChangeEvent,
  ) {
    if (event.nativeEvent.state === State.BEGAN) {
      beginTransformGesture();
    }
  }

  function handleFling(event: FlingGestureHandlerStateChangeEvent) {
    if (event.nativeEvent.state === State.ACTIVE) {
      setCounts((current) => ({ ...current, fling: current.fling + 1 }));
    }
  }

  const rotationDegrees = Math.round((transform.rotation * 180) / Math.PI);
  const statusLabel = `x ${Math.round(transform.offsetX)}, y ${Math.round(
    transform.offsetY,
  )}, scale ${transform.scale.toFixed(2)}, rotate ${rotationDegrees}`;
  const panChanged = Math.abs(transform.offsetX) > 0 || Math.abs(transform.offsetY) > 0;
  const pinchChanged = Math.abs(transform.scale - 1) > 0.01;
  const rotateChanged = rotationDegrees !== 0;

  return (
    <SectionCard
      subtitle="Image target for pan, pinch, rotate, and fling."
      title="Gesture lab"
      testID="gesture-lab-card"
    >
      <FlingGestureHandler
        direction={Directions.LEFT}
        onHandlerStateChange={handleFling}
        ref={flingLeftRef}
        simultaneousHandlers={[panRef, pinchRef, rotationRef]}
      >
        <FlingGestureHandler
          direction={Directions.RIGHT}
          onHandlerStateChange={handleFling}
          ref={flingRightRef}
          simultaneousHandlers={[panRef, pinchRef, rotationRef]}
        >
          <FlingGestureHandler
            direction={Directions.UP}
            onHandlerStateChange={handleFling}
            ref={flingUpRef}
            simultaneousHandlers={[panRef, pinchRef, rotationRef]}
          >
            <FlingGestureHandler
              direction={Directions.DOWN}
              onHandlerStateChange={handleFling}
              ref={flingDownRef}
              simultaneousHandlers={[panRef, pinchRef, rotationRef]}
            >
              <RotationGestureHandler
                onGestureEvent={handleRotation}
                onHandlerStateChange={handleTransformStateChange}
                ref={rotationRef}
                simultaneousHandlers={[panRef, pinchRef, ...flingRefs]}
              >
                <PinchGestureHandler
                  onGestureEvent={handlePinch}
                  onHandlerStateChange={handleTransformStateChange}
                  ref={pinchRef}
                  simultaneousHandlers={[panRef, rotationRef, ...flingRefs]}
                >
                  <PanGestureHandler
                    minDist={4}
                    onGestureEvent={handlePan}
                    onHandlerStateChange={handleTransformStateChange}
                    ref={panRef}
                    simultaneousHandlers={[pinchRef, rotationRef, ...flingRefs]}
                  >
                    <View
                      accessibilityLabel="Gesture test image"
                      style={styles.target}
                      testID="gesture-target"
                    >
                      <Image
                        accessibilityIgnoresInvertColors
                        accessibilityLabel="Gesture test image"
                        resizeMode="cover"
                        source={{ uri: gestureImageUri }}
                        style={[
                          styles.image,
                          {
                            transform: [
                              { translateX: transform.offsetX },
                              { translateY: transform.offsetY },
                              { scale: transform.scale },
                              { rotate: `${rotationDegrees}deg` },
                            ],
                          },
                        ]}
                        testID="gesture-target-image"
                      />
                    </View>
                  </PanGestureHandler>
                </PinchGestureHandler>
              </RotationGestureHandler>
            </FlingGestureHandler>
          </FlingGestureHandler>
        </FlingGestureHandler>
      </FlingGestureHandler>

      <View style={styles.metrics} testID="gesture-metrics">
        <Text style={styles.metric} testID="gesture-transform-status">
          {statusLabel}
        </Text>
        <Text style={styles.metric} testID="gesture-fling-status">
          fling {counts.fling}
        </Text>
        <Text style={styles.metric} testID="gesture-change-status">
          pan changed {panChanged ? 'yes' : 'no'}, pinch changed{' '}
          {pinchChanged ? 'yes' : 'no'}, rotate changed {rotateChanged ? 'yes' : 'no'}
        </Text>
      </View>
    </SectionCard>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    target: {
      alignItems: 'center',
      backgroundColor: colors.cardStrong,
      borderColor: colors.line,
      borderRadius: 4,
      borderWidth: StyleSheet.hairlineWidth,
      height: 220,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    image: {
      borderRadius: 4,
      height: 160,
      width: 240,
    },
    metrics: {
      gap: 6,
    },
    metric: {
      color: colors.textSoft,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
    },
  });
}

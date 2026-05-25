#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface RunnerSynthesizedGesture : NSObject

+ (NSString * _Nullable)synthesizeTransformWithApplication:(id)application
                                                         x:(double)x
                                                         y:(double)y
                                                        dx:(double)dx
                                                        dy:(double)dy
                                                     scale:(double)scale
                                                   degrees:(double)degrees
                                                    radius:(double)radius
                                                durationMs:(double)durationMs;

@end

NS_ASSUME_NONNULL_END

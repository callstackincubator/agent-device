#import "RunnerObjCExceptionCatcher.h"

@implementation RunnerObjCExceptionCatcher

+ (NSString * _Nullable)catchException:(NS_NOESCAPE dispatch_block_t)tryBlock {
  @try {
    tryBlock();
    return nil;
  } @catch (NSException *exception) {
    NSString *reason = exception.reason ?: @"Unhandled XCTest exception";
    return [NSString stringWithFormat:@"%@: %@", exception.name, reason];
  }
}

@end

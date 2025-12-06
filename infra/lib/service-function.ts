import { join } from 'node:path';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

const repoRoot = join(import.meta.dirname, '..', '..');

export interface ServiceFunctionProps {
  /** Handler file, relative to the repository root. It has to export a function named `handler`. */
  entry: string;
  description: string;
  environment?: Record<string, string>;
  timeout?: Duration;
}

/** A Lambda function with the settings all functions of this project share. */
export class ServiceFunction extends nodejs.NodejsFunction {
  constructor(scope: Construct, id: string, props: ServiceFunctionProps) {
    super(scope, id, {
      entry: join(repoRoot, props.entry),
      handler: 'handler',
      description: props.description,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: props.timeout ?? Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      loggingFormat: lambda.LoggingFormat.JSON,
      logGroup: new logs.LogGroup(scope, `${id}Logs`, {
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        POWERTOOLS_SERVICE_NAME: id,
        ...props.environment,
      },
      projectRoot: repoRoot,
      depsLockFilePath: join(repoRoot, 'package-lock.json'),
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node24',
        minify: true,
        sourceMap: true,
        // Bundling the SDK pins its version and lets esbuild drop the unused clients.
        bundleAwsSDK: true,
        mainFields: ['module', 'main'],
        // Some dependencies still call require(); ES modules do not define it.
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
  }
}

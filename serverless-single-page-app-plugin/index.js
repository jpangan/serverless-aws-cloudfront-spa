'use strict';

const { exec } = require('child_process');

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.commands = {
      syncToS3: {
        usage: 'Deploys the `app` directory to your bucket',
        lifecycleEvents: [
          'sync',
        ],
      },
      domainInfo: {
        usage: 'Fetches and prints out the deployed CloudFront domain names',
        lifecycleEvents: [
          'domainInfo',
        ],
      },
      invalidateCloudFrontCache: {
        usage: 'Invalidates CloudFront cache',
        lifecycleEvents: [
          'invalidateCache',
        ],
      },
    };

    this.hooks = {
      'syncToS3:sync': this.syncDirectory.bind(this),
      'domainInfo:domainInfo': this.domainInfo.bind(this),
      'invalidateCloudFrontCache:invalidateCache': this.invalidateCache.bind(
        this,
      ),
    };
  }

  /**
   * @description Returns a function that triggers the exec command and will return the callback values.
  */
  runAwsCommand(args) {
    let command = 'aws';

    if (this.serverless.variables.service.provider.region) {
      command = `${command} --region ${this.serverless.variables.service.provider.region}`;
    }
    if (this.serverless.variables.service.provider.profile) {
      command = `${command} --profile ${this.serverless.variables.service.provider.profile}`;
    }

    return exec(`${command} ${args.join(' ')}`,
      (error, stdout, stderr) => ({error, stdout, stderr}));
  }

  /**
   * @description Syncs the `app` directory to the provided bucket.
  */
  syncDirectory() {
    const s3Bucket = this.serverless.variables.service.custom.s3Bucket;
    const args = [
      's3',
      'sync',
      'app/',
      `s3://${s3Bucket}/`,
      '--delete',
    ];

    const { error } = this.runAwsCommand(args);
    if (!error) {
      this.serverless.cli.log('✅ Successfully synced to the S3 bucket 🚀🚀🚀');
    } else {
      this.serverless.cli.log('Failed')
      this.serverless.cli.log(error.stack);
      this.serverless.cli.log(`Error code: ${ error.code }`);
      this.serverless.cli.log(`Signal received: ${error.signal}`);

      throw new Error('🚫Failed syncing to the S3 bucket');
    }
  }

  /**
   * fetches the domain name from the CloudFront outputs and prints it out.
  */
  async domainInfo() {
    const provider = this.serverless.getProvider('aws');
    const stackName = provider.naming.getStackName(this.options.stage);
    const result = await provider.request(
      'CloudFormation',
      'describeStacks',
      { StackName: stackName },
      this.options.stage,
      this.options.region,
    );

    const outputs = result.Stacks[0].Outputs;
    const output = outputs.find(
      entry => entry.OutputKey === 'WebAppCloudFrontDistributionOutput',
    );

    if (output && output.OutputValue) {
      this.serverless.cli.log(`Web App Domain: ${output.OutputValue}`);
      return output.OutputValue;
    }

    this.serverless.cli.log('Web App Domain: Not Found');
    const error = new Error('Could not extract Web App Domain');
    throw error;
  }

  /**
   * @description Invalidates the cache.
  */
  async invalidateCache() {
    const provider = this.serverless.getProvider('aws');

    const domain = await this.domainInfo();

    const result = await provider.request(
      'CloudFront',
      'listDistributions',
      {},
      this.options.stage,
      this.options.region,
    );

    const distributions = result.DistributionList.Items;
    const distribution = distributions.find(
      entry => entry.DomainName === domain,
    );

    if (distribution) {
      this.serverless.cli.log(
        `Invalidating CloudFront distribution with id: ${distribution.Id}`,
      );
      const args = [
        'cloudfront',
        'create-invalidation',
        '--distribution-id',
        distribution.Id,
        '--paths',
        '/*',
      ];
      const { sterr } = this.runAwsCommand(args);
      if (!sterr) {
        this.serverless.cli.log('Successfully invalidated CloudFront cache');
      } else {
        throw new Error('Failed invalidating CloudFront cache');
      }
    } else {
      const message = `Could not find distribution with domain ${domain}`;
      const error = new Error(message);
      this.serverless.cli.log(message);
      throw error;
    }
  }
}

module.exports = ServerlessPlugin;

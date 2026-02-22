import { Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';

export interface EdgeCertificateStackProps extends StackProps {
  hostedZoneId: string;
  zoneName: string;
  domainName: string;
}

/**
 * The certificate for the web app's own domain. CloudFront only accepts certificates from
 * us-east-1, so this is the one stack outside the practice's region. It holds no data.
 */
export class EdgeCertificateStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: EdgeCertificateStackProps) {
    super(scope, id, props);
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });
    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}

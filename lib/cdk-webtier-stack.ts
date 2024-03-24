import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Duration } from "aws-cdk-lib";

export class CdkWebtierStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const defaultVpc = ec2.Vpc.fromLookup(this, "defaultVpc", {
      vpcId: "vpc-099623940d0d6367c",
    });

    //create ami (Amazon Linux 2023 AMI)
    const amiId = "ami-0c101f26f147fa7fd";
    const ami = ec2.MachineImage.genericLinux({
      "us-east-1": amiId,
    });

    const instanceType = ec2.InstanceType.of(
      ec2.InstanceClass.T2,
      ec2.InstanceSize.MICRO
    );

    // create security Group
    const securityGroup = new ec2.SecurityGroup(this, "securityGroup", {
      vpc: defaultVpc,
    });
    securityGroup.addIngressRule(
      ec2.Peer.ipv4("0.0.0.0/0"),
      ec2.Port.tcp(80),
      "Added by a CDK stack"
    );

    // Create user Data
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "sudo yum update -y",
      "sudo yum install -y httpd.x86_64",
      "sudo service httpd start",
      "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash",
      "source /home/ec2-user/.bashrc && /home/ec2-user/.nvm/nvm.sh && nvm install 16 && nvm use 16",
      "version=$(node --version)",
      "cd /home/ec2-user/",
      "aws s3 cp s3://my3webappbucket123/aws-three-tier-web-architecture-workshop/application-code/web-tier/ web-tier --recursive",
      "cd /home/ec2-user/web-tier",
      "npm install",
      "npm run build",
      "sudo amazon-linux-extras install nginx1 -y",
      "cd /etc/nginx",
      "sudo rm nginx.conf",
      "sudo aws s3 cp s3://my3webappbucket123/aws-three-tier-web-architecture-workshop/application-code/nginx.conf .",
      "sudo service nginx restart",
      "chmod -R 755 /home/ec2-user",
      "sudo chkconfig nginx on"
    );

    // Create Iam Role SSM and S3
    const role = new iam.Role(this, "roleForSSMandS3", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });
    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );
    // Attach AmazonS3ReadOnlyAccess managed policy
    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3ReadOnlyAccess")
    );

    // Create Launch Temlplate
    const launchTemplate = new ec2.LaunchTemplate(this, "LaunchTemplate", {
      machineImage: ami,
      instanceType: instanceType,
      securityGroup: securityGroup,
      userData: userData,
      role: role,
    });

    // create autoscaling group
    const autoscalingGroup = new autoscaling.AutoScalingGroup(
      this,
      "autoscalingGroup",
      {
        vpc: defaultVpc,
        launchTemplate: launchTemplate,
        // minCapacity: 2,
        // maxCapacity: 2,
        // desiredCapacity: 2,
      }
    );

    // ALB
    const alb = new elbv2.ApplicationLoadBalancer(
      this,
      "applicationLoadBalacner",
      {
        vpc: defaultVpc,
        internetFacing: true,
      }
    );

    const listener = alb.addListener("listner", {
      port: 80,
    });

    listener.addTargets("ApplicationFleet", {
      port: 80,
      targets: [autoscalingGroup],
      healthCheck: {
        path: "/",
        interval: Duration.minutes(1),
      },
    });

    autoscalingGroup.connections.allowFrom(alb, ec2.Port.tcp(80));
  }
}

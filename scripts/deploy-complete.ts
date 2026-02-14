import { ethers } from 'hardhat';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('🚀 Starting ClawKit deployment to opBNB mainnet...\n');

  const [deployer] = await ethers.getSigners();
  console.log('📝 Deploying with account:', deployer.address);
  
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log('💰 Account balance:', ethers.formatEther(balance), 'BNB\n');

  if (balance < ethers.parseEther('0.01')) {
    console.error('⚠️  Warning: Low balance! You need at least 0.01 BNB for deployment');
  }

  const deployments: any = {
    network: 'opBNB',
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {}
  };

  // Deploy DynamicBadge
  console.log('📦 Deploying DynamicBadge...');
  const DynamicBadge = await ethers.getContractFactory('DynamicBadge');
  const dynamicBadge = await DynamicBadge.deploy();
  await dynamicBadge.waitForDeployment();
  const dynamicBadgeAddress = await dynamicBadge.getAddress();
  console.log('✅ DynamicBadge deployed at:', dynamicBadgeAddress);
  deployments.contracts.DynamicBadge = dynamicBadgeAddress;

  // Deploy BatchExecutor
  console.log('\n📦 Deploying BatchExecutor...');
  const BatchExecutor = await ethers.getContractFactory('BatchExecutor');
  const batchExecutor = await BatchExecutor.deploy();
  await batchExecutor.waitForDeployment();
  const batchExecutorAddress = await batchExecutor.getAddress();
  console.log('✅ BatchExecutor deployed at:', batchExecutorAddress);
  deployments.contracts.BatchExecutor = batchExecutorAddress;

  // Deploy ApprovalRevoker
  console.log('\n📦 Deploying ApprovalRevoker...');
  const ApprovalRevoker = await ethers.getContractFactory('ApprovalRevoker');
  const approvalRevoker = await ApprovalRevoker.deploy();
  await approvalRevoker.waitForDeployment();
  const approvalRevokerAddress = await approvalRevoker.getAddress();
  console.log('✅ ApprovalRevoker deployed at:', approvalRevokerAddress);
  deployments.contracts.ApprovalRevoker = approvalRevokerAddress;

  // Save deployment info
  const deploymentDir = path.join(__dirname, '../deployment');
  if (!fs.existsSync(deploymentDir)) {
    fs.mkdirSync(deploymentDir, { recursive: true });
  }

  const deploymentFile = path.join(deploymentDir, 'addresses.json');
  fs.writeFileSync(deploymentFile, JSON.stringify(deployments, null, 2));
  console.log('\n💾 Deployment info saved to:', deploymentFile);

  // Update types.ts
  console.log('\n📝 Updating src/types.ts with contract addresses...');
  const typesPath = path.join(__dirname, '../src/types.ts');
  let typesContent = fs.readFileSync(typesPath, 'utf-8');
  
  // Update CLAWKIT_CONTRACTS
  const contractsRegex = /export const CLAWKIT_CONTRACTS = \{[\s\S]*?\};/;
  const newContracts = `export const CLAWKIT_CONTRACTS = {
  DynamicBadge: '${dynamicBadgeAddress}' as const,
  BatchExecutor: '${batchExecutorAddress}' as const,
  ApprovalRevoker: '${approvalRevokerAddress}' as const,
};`;
  
  typesContent = typesContent.replace(contractsRegex, newContracts);
  fs.writeFileSync(typesPath, typesContent);
  console.log('✅ Updated src/types.ts');

  // Print summary
  console.log('\n🎉 DEPLOYMENT COMPLETE!\n');
  console.log('📋 Summary:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DynamicBadge:    ', dynamicBadgeAddress);
  console.log('BatchExecutor:   ', batchExecutorAddress);
  console.log('ApprovalRevoker: ', approvalRevokerAddress);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('📝 Next steps:');
  console.log('1. Verify contracts: npm run verify');
  console.log('2. Generate test transactions: npm run test:generate');
  console.log('3. Check submission package: npm run submission:check\n');

  console.log('🔗 View on opBNBScan:');
  console.log(`https://opbnbscan.com/address/${dynamicBadgeAddress}`);
  console.log(`https://opbnbscan.com/address/${batchExecutorAddress}`);
  console.log(`https://opbnbscan.com/address/${approvalRevokerAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

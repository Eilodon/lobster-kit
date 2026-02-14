const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying ClawKit contracts to", hre.network.name);
  console.log("=====================================\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());
  console.log();

  // Deploy DynamicBadge
  console.log("📦 Deploying DynamicBadge...");
  const DynamicBadge = await hre.ethers.getContractFactory("DynamicBadge");
  const dynamicBadge = await DynamicBadge.deploy();
  await dynamicBadge.waitForDeployment();
  const badgeAddress = await dynamicBadge.getAddress();
  console.log("✅ DynamicBadge deployed to:", badgeAddress);
  console.log();

  // Deploy BatchExecutor
  console.log("📦 Deploying BatchExecutor...");
  const BatchExecutor = await hre.ethers.getContractFactory("BatchExecutor");
  const batchExecutor = await BatchExecutor.deploy();
  await batchExecutor.waitForDeployment();
  const executorAddress = await batchExecutor.getAddress();
  console.log("✅ BatchExecutor deployed to:", executorAddress);
  console.log();

  // Deploy ApprovalRevoker
  console.log("📦 Deploying ApprovalRevoker...");
  const ApprovalRevoker = await hre.ethers.getContractFactory("ApprovalRevoker");
  const approvalRevoker = await ApprovalRevoker.deploy();
  await approvalRevoker.waitForDeployment();
  const revokerAddress = await approvalRevoker.getAddress();
  console.log("✅ ApprovalRevoker deployed to:", revokerAddress);
  console.log();

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      DynamicBadge: {
        address: badgeAddress,
        explorer: `https://opbnb.bscscan.com/address/${badgeAddress}`
      },
      BatchExecutor: {
        address: executorAddress,
        explorer: `https://opbnb.bscscan.com/address/${executorAddress}`
      },
      ApprovalRevoker: {
        address: revokerAddress,
        explorer: `https://opbnb.bscscan.com/address/${revokerAddress}`
      }
    }
  };

  // Write to bsc.address file
  const addressFile = path.join(__dirname, "..", "bsc.address");
  fs.writeFileSync(addressFile, JSON.stringify(deploymentInfo, null, 2));
  console.log("💾 Deployment info saved to bsc.address");
  console.log();

  // Update types.ts with addresses
  const typesPath = path.join(__dirname, "..", "src", "types.ts");
  let typesContent = fs.readFileSync(typesPath, "utf8");
  
  typesContent = typesContent.replace(
    /DynamicBadge: '0x[0-9a-fA-F]{40}'/,
    `DynamicBadge: '${badgeAddress}'`
  );
  typesContent = typesContent.replace(
    /BatchExecutor: '0x[0-9a-fA-F]{40}'/,
    `BatchExecutor: '${executorAddress}'`
  );
  typesContent = typesContent.replace(
    /ApprovalRevoker: '0x[0-9a-fA-F]{40}'/,
    `ApprovalRevoker: '${revokerAddress}'`
  );
  
  fs.writeFileSync(typesPath, typesContent);
  console.log("✅ Updated src/types.ts with deployed addresses");
  console.log();

  console.log("=====================================");
  console.log("🎉 All contracts deployed successfully!");
  console.log("=====================================");
  console.log("\n📋 Summary:");
  console.log(`DynamicBadge:     ${badgeAddress}`);
  console.log(`BatchExecutor:    ${executorAddress}`);
  console.log(`ApprovalRevoker:  ${revokerAddress}`);
  console.log("\n🔗 Verify contracts:");
  console.log(`npx hardhat verify --network ${hre.network.name} ${badgeAddress}`);
  console.log(`npx hardhat verify --network ${hre.network.name} ${executorAddress}`);
  console.log(`npx hardhat verify --network ${hre.network.name} ${revokerAddress}`);
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

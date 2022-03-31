import { expect } from "chai";
import { ethers } from "hardhat";

import {BigNumber, Wallet} from "ethers";
import {MockProvider, deployContract} from 'ethereum-waffle';
import {createFixtureLoader} from 'ethereum-waffle';

describe("LFWIDOPoolToken", function () {

    const provider = new MockProvider();
    const [wallet] = provider.getWallets();

    const loadFixture = createFixtureLoader([wallet], provider);

    async function fixture([wallet]: Wallet[], _mockProvider: MockProvider) {
        const [owner] = await ethers.getSigners();

        const LFWIDOPoolToken = await ethers.getContractFactory("LFWIDOPoolToken");
        const poolToken = await LFWIDOPoolToken.deploy();
        await poolToken.deployed();

        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        const tokenLFW = await ERC20Mock.deploy("LFW", "LFW" , owner.address, BigNumber.from(10).pow(22));
        await tokenLFW.deployed();

        console.log("lfwToken.address: ", tokenLFW.address);
        console.log("wallet.address: ", wallet.address);
        console.log("poolToken.address: ", poolToken.address);
        console.log("owner.address: ", owner.address);
     
        return {owner, tokenLFW, wallet, poolToken};
      }

    it("first testcase", async function () {
        const {owner, tokenLFW, wallet, poolToken} = await loadFixture(fixture);

        console.log("initalize LFW Staking Pool");
        await poolToken.initialize(tokenLFW.address, false, 7, owner.address);
        await poolToken.changeAPY(8);

        // TODO need to understand approve function
        console.log("approve poolToken");
        tokenLFW.approve(poolToken.address, 10000000000000)

        // have owner owns some LFW tokens
        await tokenLFW.transfer(owner.address, 10000);
        
        // user stake some tokens
        console.log("user stake some tokens");
        await expect(poolToken.stake(10))
            .to.emit(poolToken, 'Stake')
            .withArgs(owner.address, 10);

        console.log("user claim reward");
        await poolToken.claim();
    });

});

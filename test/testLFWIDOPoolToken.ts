import { expect } from "chai";
import { ethers } from "hardhat";

import {Contract, BigNumber, Wallet} from "ethers";
import {MockProvider, deployContract} from 'ethereum-waffle';
import {createFixtureLoader} from 'ethereum-waffle';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

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
        console.log("poolToken.address: ", poolToken.address);
        console.log("owner.address: ", owner.address);

        console.log("initalize LFW Staking Pool");
        await poolToken.initialize(tokenLFW.address, false, 7, owner.address);

        // TODO need to understand approve function
        console.log("approve poolToken");
        tokenLFW.approve(poolToken.address, 10000000000000)

        // have owner own some LFW tokens
        await tokenLFW.transfer(owner.address, 10000);
     
        return {owner, tokenLFW, poolToken};
    }

    let owner: SignerWithAddress
    let tokenLFW: Contract
    let poolToken: Contract

    beforeEach(async function() {
        const _fixture = await loadFixture(fixture);
        owner = _fixture.owner;
        tokenLFW = _fixture.tokenLFW;
        poolToken = _fixture.poolToken;
    });

    it ("change APY", async function () {        
        poolToken.changeAPY(8);
        // TODO how to verify this?
    });

    it("failed to claim when user hasn't staked", async function () {       
        await expect(poolToken.claim())
            .to.be.revertedWith("You do not stake anything");
    });

    it("stake & claim", async function () {       
        // user stake some tokens
        console.log("user stake some tokens");
        await expect(poolToken.stake(10))
            .to.emit(poolToken, 'Stake')
            .withArgs(owner.address, 10);

        console.log("user claim reward");
        await expect(await poolToken.claim())
            .to.emit(poolToken, 'Claimed');
        
        console.log(await tokenLFW.balanceOf(owner.address));
        // TODO write a check here
        // expect(await tokenLFW.balanceOf(owner.address)).to.be.within(10000-10, 10000);
    });

    it("failed to unstake before 30 days expired", async function () {
        await expect(poolToken.unStake(10))
            .to.be.revertedWith("Your token is still at the 30-days locked period!");
    });

});

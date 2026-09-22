import {test,expect} from '@playwright/test';
import {normalize} from '../../public/core.js';
test('budget button stays below cards and clear of navigation at mobile and desktop widths',async({page,request})=>{
  const headers={'x-accountbook-protocol':'2'};
  const current=await (await request.get('/api/data',{headers})).json();
  const data=normalize({users:[{id:'1',name:'사용자'}],assets:Array.from({length:12},(_,i)=>({id:'a'+i,name:'예산 '+(i+1),budget:100000})),transactions:[]});
  expect((await request.put('/api/data',{headers,data:{baseRevision:current.revision,data}})).ok()).toBe(true);
  await page.goto('/');
  await expect(page.locator('#globalSyncPill')).toHaveText('저장 완료');
  await page.locator('.nav-item[data-tab=assets]').click();
  for(const width of [390,1588]) {
    await page.setViewportSize({width,height:844});
    await page.locator('#setBudgetBtn').scrollIntoViewIfNeeded();
    const rects=await page.evaluate(()=>{
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
      return {card:rect('#assetsList .asset-card:last-child'),button:rect('#setBudgetBtn'),nav:rect('.bottom-nav'),position:getComputedStyle(document.querySelector('#setBudgetBtn')).position};
    });
    expect(rects.position).toBe('static');
    expect(rects.button.top).toBeGreaterThanOrEqual(rects.card.bottom+10);
    const {button:b,nav:n}=rects;
    expect(b.bottom<=n.top||b.top>=n.bottom||b.right<=n.left||b.left>=n.right).toBe(true);
    await page.screenshot({path:`test-results/budget-fixed-${width}.png`});
    await page.locator('#setBudgetBtn').click();
    await expect(page.locator('#budgetModal')).toHaveClass(/active/);
    await page.locator('#budgetModal .modal-close').click();
  }
});

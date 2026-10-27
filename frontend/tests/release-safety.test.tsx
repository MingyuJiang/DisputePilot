import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n';
import { ReplayDialog } from '../src/components/domain/ReplayDialog';
import { ExecutionStatusCard } from '../src/components/domain/ExecutionStatusCard';
import { ExecutionRecordPanel } from '../src/components/domain/ExecutionRecordPanel';
import { disputePilot } from '../src/api';
import { mapExecutionToReplayResult } from '../src/api/mapping';
import type { ReplayResult } from '../src/api/types';

const completed: ReplayResult = {outcome:'SUCCEEDED',httpStatus:200,message:'Synthetic replay result only',revalidation:[{label:'Verification method',status:'INFO',note:'Frozen fixture comparison'}],simulated:true,executionMode:'REPLAY'};
const dialog = (open:boolean) => <MemoryRouter><LanguageProvider initialLang="en"><ReplayDialog open={open} proposalId="P-RELEASE" caseId="C-RELEASE" onClose={()=>undefined}/></LanguageProvider></MemoryRouter>;
afterEach(()=>vi.restoreAllMocks());

describe('release replay safety',()=>{
  it('accepts a real response after closing and reopening a failed attempt',async()=>{
    const replay=vi.spyOn(disputePilot,'replay').mockRejectedValueOnce({status:403,code:'FORBIDDEN',message:'Manager required'}).mockResolvedValueOnce(completed);
    const view=render(dialog(true));
    expect(await screen.findByRole('alert')).toHaveTextContent('Manager required');
    view.rerender(dialog(false));view.rerender(dialog(true));
    expect(await screen.findByText('Synthetic replay result only')).toBeInTheDocument();
    expect(replay).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button',{name:'Done'})).toBeEnabled();
  });
  it('stays pending until the backend answers and exposes network failure without success',async()=>{
    let reject!:(value:unknown)=>void;
    vi.spyOn(disputePilot,'replay').mockImplementation(()=>new Promise((_,r)=>{reject=r;}));
    render(dialog(true));
    expect(screen.queryByText('Synthetic replay result only')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Revalidating…'})).toBeDisabled();
    reject({status:0,code:'NETWORK_ERROR',message:'Connection lost'});
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.queryByText(/0\/0/)).not.toBeInTheDocument();
  });
  it('allows an explicit retry after a permission denial',async()=>{
    const replay=vi.spyOn(disputePilot,'replay').mockRejectedValueOnce({status:403,code:'FORBIDDEN',message:'Manager required'}).mockResolvedValueOnce(completed);
    render(dialog(true));await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button',{name:'Retry revalidation'}));
    expect(await screen.findByText('Synthetic replay result only')).toBeInTheDocument();
    expect(replay).toHaveBeenCalledTimes(2);
  });
  it('renders actual report labels and preserves skipped findings',async()=>{
    vi.spyOn(disputePilot,'replay').mockResolvedValue({...completed,outcome:'BLOCKED',httpStatus:422,revalidation:[{label:'V5 missing material',status:'FAIL',note:'Proof is missing'},{label:'V6 amount not applicable',status:'SKIPPED',note:'No money action'}]});
    render(dialog(true));
    expect(await screen.findByText('V5 missing material')).toBeInTheDocument();
    expect(screen.getByText('V6 amount not applicable')).toBeInTheDocument();
    expect(screen.getByText('0/1 checks passed')).toBeInTheDocument();
    expect(screen.queryByText('Snapshot freshness')).not.toBeInTheDocument();
  });
  it('does not turn verification metadata into passing validator checks',async()=>{
    vi.spyOn(disputePilot,'replay').mockResolvedValue(completed);
    render(dialog(true));await screen.findByText('Synthetic replay result only');
    expect(screen.getByText('Verification method')).toBeInTheDocument();
    expect(screen.queryByText(/\d+\/\d+ checks passed/)).not.toBeInTheDocument();
    const result=mapExecutionToReplayResult({execution_id:'E',proposal_id:'P',case_id:'C',result:'REPLAYED',execution_mode:'REPLAY',simulated:true,gateway:'ReplayExecutionGateway',request_snapshot:{},response_snapshot:{},verification:{method:'fixture',state_before:{status:'before'},state_after_expected:{status:'after'}},created_at:'2026-10-25T00:00:00Z'});
    expect(result.revalidation).toHaveLength(3);
    expect(result.revalidation.every(x=>x.status==='INFO')).toBe(true);
  });
  it('never shows remote confirmation for a legacy simulated record in either panel',()=>{
    const execution={executionMode:'REPLAY',simulated:true,result:'REPLAYED' as const,verification:{method:'fixture',basis:'FIXTURE_SNAPSHOT',confirmed:true}};
    render(<MemoryRouter><LanguageProvider initialLang="en"><ExecutionStatusCard execution={execution} caseId="C"/><ExecutionRecordPanel execution={execution}/></LanguageProvider></MemoryRouter>);
    expect(screen.getAllByText('Not applicable — offline replay')).toHaveLength(2);
  });
  it('keeps an offline refund replay completed when remote confirmation is explicitly false',()=>{
    const execution={executionMode:'REPLAY',simulated:true,result:'REPLAYED' as const,verification:{method:'fixture',basis:'FIXTURE_SNAPSHOT',confirmed:false,remote_readback:false}};
    render(<LanguageProvider initialLang="en"><ExecutionRecordPanel execution={execution}/></LanguageProvider>);
    expect(screen.getByText('Not applicable — offline replay')).toBeInTheDocument();
    expect(screen.queryByText('Result unknown')).not.toBeInTheDocument();
  });
});

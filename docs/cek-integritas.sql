select '1 total <> subtotal - diskon' as cek, count(*) as baris
from sales where total <> subtotal - discount_amount
union all
select '2 subtotal <> jumlah item', count(*)
from sales s
left join (
  select sale_id, sum(line_total) as items_total from sale_items group by sale_id
) i on i.sale_id = s.id
where i.sale_id is null or i.items_total <> s.subtotal
union all
select '3 pembayaran tidak cocok', count(*)
from sales s left join payments p on p.sale_id = s.id
where p.id is null or p.amount <> s.total or p.tendered - p.amount <> p.change_amount
union all
select '4 stok <> riwayat', count(*)
from inventory i
left join (
  select store_id, variant_id, sum(delta) as d
  from stock_movements group by store_id, variant_id
) m on m.store_id = i.store_id and m.variant_id = i.variant_id
where i.qty <> coalesce(m.d, 0)
union all
select '5 penanda batal', count(*)
from sales where (status = 'void') <> (voided_at is not null)
union all
select '6a batal tidak netral', count(*) from (
  select s.id from sales s join stock_movements m on m.ref_sale_id = s.id
  where s.status = 'void' group by s.id having sum(m.delta) <> 0
) x
union all
select '6b selesai tidak cocok item', count(*) from (
  select s.id from sales s join stock_movements m on m.ref_sale_id = s.id
  where s.status = 'completed' group by s.id
  having sum(m.delta) <> -(select sum(qty) from sale_items where sale_id = s.id)
) y
union all
select '6c selesai tanpa pergerakan stok', count(*)
from sales s
where s.status = 'completed'
  and not exists (select 1 from stock_movements m where m.ref_sale_id = s.id)
union all
select '7 nomor struk terakhir', count(*) from (
  select st.id from stores st left join sales s on s.store_id = st.id
  group by st.id, st.last_receipt_no
  having st.last_receipt_no < coalesce(max(s.receipt_no), 0)
) z
union all
select '8a stok negatif (info)', count(*) from inventory where qty < 0
union all
select '8b konflik terbuka (info)', count(*) from sale_conflicts where status = 'open';
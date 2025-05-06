import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Sale } from './sale.entity';

@Entity('products') // Nombre de la tabla en la BD
export class Product {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 100 })
    name: string;

    @Column('decimal', { precision: 10, scale: 2 })
    price: number;

    @Column()
    description: string;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    createdAt: Date;

    @OneToMany(() => Sale, sale => sale.product)
    sales: Sale[];
}
